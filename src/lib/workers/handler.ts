import { collectTransferables } from '../asset/payload';
import { loadOcct } from '../decoders/occtWasm';
import type { AssetFile, LoadContext, LoadInput } from '../registry/types';
import { GEOMETRY_PIPELINES, NEEDS_OCCT } from './geometryPipelines';
import type { PostMessage, WorkerRequest } from './protocol';

/**
 * Everything the parse worker does.
 *
 * Deliberately a plain module with `post` injected and no reference to `self`, so the worker
 * file itself is a dozen lines with nothing to test, and all of this runs under Node against
 * a fake `post`. Testing the logic here rather than through a real worker is what makes the
 * message protocol, the transfer list and the error shape verifiable at all.
 */
export interface HandlerState {
  /** Requests the caller has abandoned. Checked between phases; parsing itself cannot yield. */
  readonly cancelled: Set<number>;
  occtReady: boolean;
}

export function createHandlerState(): HandlerState {
  return { cancelled: new Set(), occtReady: false };
}

export async function handleRequest(
  request: WorkerRequest,
  post: PostMessage,
  state: HandlerState,
): Promise<void> {
  if (request.type === 'cancel') {
    state.cancelled.add(request.id);
    return;
  }

  const { id, format, fileName, bytes, companions, quality, wasmBinary } = request;

  try {
    const resolve = GEOMETRY_PIPELINES[format];
    if (!resolve) {
      // A scene format reaching the worker is a routing bug, not a user error.
      throw new Error(`"${format}" cannot be parsed in a worker.`);
    }

    if (NEEDS_OCCT.has(format) && !state.occtReady) {
      if (!wasmBinary) throw new Error('The CAD engine was not supplied to the worker.');
      post({ type: 'progress', id, phase: 'Loading the CAD engine', ratio: null });
      await loadOcct(wasmBinary);
      state.occtReady = true;
    }

    if (state.cancelled.has(id)) {
      state.cancelled.delete(id);
      return;
    }

    const pipeline = await resolve();
    const controller = new AbortController();
    if (state.cancelled.has(id)) controller.abort();

    const companionFiles = new Map<string, AssetFile>(
      Object.entries(companions).map(([path, buffer]) => [path, { name: path, path, bytes: buffer }]),
    );
    const input: LoadInput = {
      primary: { name: fileName, path: fileName, bytes },
      companions: companionFiles,
    };
    const ctx: LoadContext = {
      onProgress: (phase, ratio) => post({ type: 'progress', id, phase, ratio }),
      // Warnings ride back inside the result rather than as separate messages, so a late
      // one cannot arrive after the caller has already resolved.
      warn: () => {},
      signal: controller.signal,
      quality,
    };

    const out = await pipeline.transcode(input, ctx);

    if (state.cancelled.has(id)) {
      state.cancelled.delete(id);
      return;
    }

    // Transfer rather than copy: this is the whole reason the payload is three-free.
    post({ type: 'result', id, out }, collectTransferables(out.scene));
  } catch (error) {
    state.cancelled.delete(id);
    const err = error as { name?: string; message?: string };
    post({
      type: 'error',
      id,
      name: err?.name ?? 'Error',
      message: err?.message ?? String(error),
    });
  }
}
