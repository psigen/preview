import type { FormatId } from '../format-id';
import type { QualityOptions } from '../registry/types';
import { NEEDS_OCCT, isWorkerEligible } from './geometryPipelines';
import type { ParseRequest, TranscodeResult, WorkerResponse } from './protocol';

/**
 * The main thread's handle on the parse worker.
 *
 * One worker for the session, created on first use: the app shows one model at a time, so a
 * pool would buy nothing, and a warm worker keeps the 8 MB Open CASCADE compile it has
 * already paid for.
 *
 * Cancellation is `terminate()`. STLLoader.parse and occt.ReadFile are synchronous C-like
 * loops with no yield point, so a cooperative signal can only be checked BETWEEN phases —
 * anything mid-parse has to be dropped by discarding the whole worker. Honest, and it means
 * one lifecycle rather than two.
 */

export interface ParseOptions {
  readonly format: FormatId;
  readonly fileName: string;
  readonly bytes: ArrayBuffer;
  readonly companions: Record<string, ArrayBuffer>;
  readonly quality: QualityOptions;
  onProgress?(phase: string, ratio: number | null): void;
  /** Supplies the CAD engine bytes; only called for a format that needs them. */
  loadWasm?(): Promise<ArrayBuffer>;
}

interface Pending {
  resolve(out: TranscodeResult): void;
  reject(error: Error): void;
  onProgress?(phase: string, ratio: number | null): void;
}

let worker: Worker | null = null;
let pending = new Map<number, Pending>();
let nextId = 1;
let occtSent = false;

/** Whether this environment can run a worker at all. Node and a hostile CSP cannot. */
export function workersAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

export { isWorkerEligible };

function ensureWorker(): Worker {
  if (worker) return worker;

  const created = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.type === 'progress') {
      entry.onProgress?.(message.phase, message.ratio);
      return;
    }
    pending.delete(message.id);
    if (message.type === 'result') entry.resolve(message.out);
    else entry.reject(Object.assign(new Error(message.message), { name: message.name }));
  };
  created.onerror = (event) => {
    // The worker itself died: fail everything outstanding rather than leaving callers
    // waiting forever, and drop it so the next request builds a fresh one.
    const error = new Error(event.message || 'The parse worker stopped unexpectedly.');
    failAll(error);
    disposeWorker();
  };

  worker = created;
  return created;
}

function failAll(error: Error): void {
  for (const entry of pending.values()) entry.reject(error);
  pending = new Map();
}

export function disposeWorker(): void {
  worker?.terminate();
  worker = null;
  occtSent = false;
}

export async function parseInWorker(options: ParseOptions): Promise<TranscodeResult> {
  const active = ensureWorker();
  const id = nextId++;

  // The CAD engine is 7.6 MB, so it is fetched only for a format that needs it, and sent
  // once per worker.
  let wasmBinary: ArrayBuffer | undefined;
  if (NEEDS_OCCT.has(options.format) && !occtSent) {
    if (!options.loadWasm) throw new Error('No CAD engine source was provided.');
    wasmBinary = await options.loadWasm();
    occtSent = true;
  }

  const request: ParseRequest = {
    type: 'parse',
    id,
    format: options.format,
    fileName: options.fileName,
    bytes: options.bytes,
    companions: options.companions,
    quality: options.quality,
    ...(wasmBinary ? { wasmBinary } : {}),
  };

  const transfer = [options.bytes, ...Object.values(options.companions)];
  if (wasmBinary) transfer.push(wasmBinary);

  return new Promise<TranscodeResult>((resolve, reject) => {
    pending.set(id, { resolve, reject, ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
    // Deduped: a companion may share a buffer with the primary, and transferring the same
    // ArrayBuffer twice throws.
    active.postMessage(request, { transfer: [...new Set(transfer)] });
  });
}
