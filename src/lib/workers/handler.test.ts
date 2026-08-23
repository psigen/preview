import { describe, expect, it } from 'vitest';
import { extentsIn } from '../../../test/gen/box';
import { stlAscii, stlBinary, plyAscii } from '../../../test/gen/writers';
import { DEFAULT_QUALITY } from '../registry/types';
import { createHandlerState, handleRequest } from './handler';
import { GEOMETRY_PIPELINES, isWorkerEligible } from './geometryPipelines';
import { registry } from '../registry';
import type { ParseRequest, WorkerResponse } from './protocol';

const mm = extentsIn('millimeter');

/** A fake `post`, so the whole protocol is exercised with no worker involved. */
function recorder() {
  const messages: WorkerResponse[] = [];
  const transfers: ArrayBuffer[][] = [];
  const post = (response: WorkerResponse, transfer?: ArrayBuffer[]) => {
    messages.push(response);
    transfers.push(transfer ?? []);
  };
  return { messages, transfers, post };
}

/** Narrowing helpers: `toBeDefined()` satisfies the runtime but not the type checker. */
function expectResult(messages: readonly WorkerResponse[]) {
  const message = messages.find((m) => m.type === 'result');
  if (message?.type !== 'result') throw new Error('expected a result message');
  return message;
}

function expectError(messages: readonly WorkerResponse[]) {
  const message = messages.find((m) => m.type === 'error');
  if (message?.type !== 'error') throw new Error('expected an error message');
  return message;
}

const parse = (over: Partial<ParseRequest> = {}): ParseRequest => ({
  type: 'parse',
  id: 1,
  format: 'stl',
  fileName: 'box.stl',
  bytes: stlBinary(mm),
  companions: {},
  quality: DEFAULT_QUALITY,
  ...over,
});

describe('handleRequest', () => {
  it('parses and posts a result', async () => {
    const { messages, post } = recorder();
    await handleRequest(parse(), post, createHandlerState());

    expect(expectResult(messages).out.counts.triangles).toBe(12);
    expect(messages.some((m) => m.type === 'error')).toBe(false);
  });

  it('forwards progress before the result', async () => {
    const { messages, post } = recorder();
    await handleRequest(
      parse({ format: 'ply', fileName: 'box.ply', bytes: plyAscii(mm) }),
      post,
      createHandlerState(),
    );
    const kinds = messages.map((m) => m.type);
    expect(kinds).toContain('progress');
    expect(kinds.indexOf('progress')).toBeLessThan(kinds.indexOf('result'));
  });

  /**
   * The transfer list is the reason the payload is three-free. Missing an entry silently
   * copies megabytes; listing one twice throws.
   */
  it('transfers every payload buffer, exactly once each', async () => {
    const { messages, transfers, post } = recorder();
    await handleRequest(parse(), post, createHandlerState());

    const at = messages.findIndex((m) => m.type === 'result');
    const listed = transfers[at]!;
    expect(listed.length).toBeGreaterThan(0);
    expect(new Set(listed).size).toBe(listed.length);

    for (const mesh of expectResult(messages).out.scene.meshes) {
      expect(listed).toContain(mesh.positions.buffer);
      if (mesh.indices) expect(listed).toContain(mesh.indices.buffer);
    }
  });

  it('reports a parse failure as a plain error message', async () => {
    const { messages, post } = recorder();
    const garbage = new TextEncoder().encode('not an stl at all').buffer as ArrayBuffer;
    await handleRequest(parse({ bytes: garbage }), post, createHandlerState());

    // Plain fields, because an Error does not structured-clone its stack reliably.
    const error = expectError(messages);
    expect(typeof error.message).toBe('string');
    expect(typeof error.name).toBe('string');
  });

  it('refuses a format that cannot run in a worker', async () => {
    const { messages, post } = recorder();
    // Routing a scene format here is a bug, and it must say so rather than hang.
    await handleRequest(parse({ format: 'usd' }), post, createHandlerState());
    expect(expectError(messages).message).toMatch(/cannot be parsed in a worker/i);
  });

  it('refuses a CAD request with no engine supplied', async () => {
    const { messages, post } = recorder();
    await handleRequest(parse({ format: 'step', fileName: 'p.step' }), post, createHandlerState());
    expect(expectError(messages).message).toMatch(/CAD engine was not supplied/i);
  });

  /**
   * The CAD path end to end through the worker protocol, with the engine handed in exactly
   * as the main thread would send it — which is the only way it can work, since emscripten
   * cannot locate its own wasm inside a module worker.
   */
  it('parses STEP when the engine is supplied, and only needs it once', async () => {
    const { readFile } = await import('node:fs/promises');
    const { createRequire } = await import('node:module');
    const require_ = createRequire(import.meta.url);
    const raw = await readFile(require_.resolve('occt-import-js/dist/occt-import-js.wasm'));
    const wasmBinary = raw.buffer.slice(
      raw.byteOffset,
      raw.byteOffset + raw.byteLength,
    ) as ArrayBuffer;
    const step = await readFile(new URL('../../../test/fixtures/box-mm.step', import.meta.url));
    const stepBytes = () =>
      step.buffer.slice(step.byteOffset, step.byteOffset + step.byteLength) as ArrayBuffer;

    const { messages, post } = recorder();
    const state = createHandlerState();

    await handleRequest(
      parse({ id: 1, format: 'step', fileName: 'box-mm.step', bytes: stepBytes(), wasmBinary }),
      post,
      state,
    );
    const first = expectResult(messages);
    expect(first.out.counts.triangles).toBe(12);
    expect(first.out.units.known).toBe(true);
    expect(state.occtReady).toBe(true);

    // A second CAD request must not require the 7.6 MB engine again.
    const second = recorder();
    await handleRequest(
      parse({ id: 2, format: 'step', fileName: 'box-mm.step', bytes: stepBytes() }),
      second.post,
      state,
    );
    expect(second.messages.some((m) => m.type === 'error')).toBe(false);
    expect(second.messages.some((m) => m.type === 'result')).toBe(true);
  }, 60_000);

  it('drops a request cancelled before it ran', async () => {
    const { messages, post } = recorder();
    const state = createHandlerState();
    await handleRequest({ type: 'cancel', id: 1 }, post, state);
    await handleRequest(parse({ id: 1 }), post, state);
    expect(messages.some((m) => m.type === 'result')).toBe(false);
  });

  it('keeps the ids of concurrent requests apart', async () => {
    const { messages, post } = recorder();
    const state = createHandlerState();
    await Promise.all([
      handleRequest(parse({ id: 7, bytes: stlAscii(mm) }), post, state),
      handleRequest(
        parse({ id: 9, format: 'ply', fileName: 'b.ply', bytes: plyAscii(mm) }),
        post,
        state,
      ),
    ]);
    const results = messages.filter((m) => m.type === 'result');
    expect(results.map((m) => m.id).sort()).toEqual([7, 9]);
  });

  it('does not throw out of handleRequest, whatever happens', async () => {
    const { post } = recorder();
    await expect(
      handleRequest(parse({ bytes: new ArrayBuffer(0) }), post, createHandlerState()),
    ).resolves.toBeUndefined();
  });
});

/**
 * The worker cannot import the registry — that would drag in every scene loader — so the two
 * lists are separate by necessity. This is what stops them drifting.
 */
describe('the worker map matches the registry', () => {
  it('covers every geometry-kind format, and nothing else', async () => {
    const workerFormats = new Set(Object.keys(GEOMETRY_PIPELINES));
    const missing: string[] = [];
    const extra: string[] = [];

    for (const descriptor of registry.list()) {
      const kind = (await descriptor.pipeline()).kind;
      const inWorker = workerFormats.has(descriptor.id);
      if (kind === 'geometry' && !inWorker) missing.push(descriptor.id);
      if (kind === 'scene' && inWorker) extra.push(descriptor.id);
    }

    expect(missing, 'geometry formats the worker cannot run').toEqual([]);
    expect(extra, 'scene formats wrongly marked worker-eligible').toEqual([]);
  });

  it('agrees with isWorkerEligible', () => {
    expect(isWorkerEligible('stl')).toBe(true);
    expect(isWorkerEligible('step')).toBe(true);
    expect(isWorkerEligible('usd')).toBe(false);
    expect(isWorkerEligible('gltf')).toBe(false);
  });
});
