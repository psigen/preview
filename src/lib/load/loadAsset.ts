/**
 * bytes -> detect -> pipeline -> finalize.
 *
 * Detection returns an ORDERED candidate list rather than a single answer, and this tries
 * each in turn, falling through when one throws. That is the honest response to genuinely
 * ambiguous input: an .stl that is really a PLY, a .zip that could be USDZ or 3MF. Guessing
 * once and failing would be worse than trying the second-best reading.
 */
import { buildScene } from '../asset/payload';
import type { LoadedModel, LoadWarning, RawAsset } from '../asset/types';
import { warn } from '../asset/types';
import { detectFormat } from '../detect/detect';
import { makeProbe } from '../detect/probe';
import { snifferFor } from '../detect/detect';
import type { FormatId } from '../format-id';
import { registry } from '../registry';
import { fetchOcctWasm } from '../decoders/occtWasm';
import { isWorkerEligible, parseInWorker, workersAvailable } from '../workers/client';
import type { TranscodeResult } from '../workers/protocol';
import {
  DEFAULT_QUALITY,
  type LoadContext,
  type LoadInput,
  type ProgressReport,
  type QualityOptions,
} from '../registry/types';
import type { GeometryPipeline } from '../registry/types';
import { finalize } from './finalize';

/**
 * Run a geometry pipeline, in a worker where that is possible.
 *
 * The inline path is not a lesser fallback — it is the same `transcode` call, and it is what
 * the test suite exercises, so tests run production code rather than a parallel
 * implementation.
 *
 * @param mayTransfer whether the input buffers can be handed over rather than copied.
 * Transferring DETACHES them, so it is only safe once no other format candidate could still
 * need to read them.
 */
async function runTranscode(
  format: FormatId,
  pipeline: GeometryPipeline,
  input: LoadInput,
  ctx: LoadContext,
  mayTransfer: boolean,
): Promise<TranscodeResult> {
  if (!workersAvailable() || !isWorkerEligible(format)) {
    return pipeline.transcode(input, ctx);
  }

  const companions: Record<string, ArrayBuffer> = {};
  for (const [path, file] of input.companions) {
    companions[path] = mayTransfer ? file.bytes : file.bytes.slice(0);
  }

  try {
    return await parseInWorker({
      format,
      fileName: input.primary.name,
      bytes: mayTransfer ? input.primary.bytes : input.primary.bytes.slice(0),
      companions,
      quality: ctx.quality,
      onProgress: ctx.onProgress,
      loadWasm: fetchOcctWasm,
    });
  } catch (err) {
    // A worker that could not even be constructed — a hostile CSP, say — is an environment
    // problem rather than a parse failure, and the buffers are still intact because nothing
    // was transferred. Anything else is a genuine error and must surface.
    if (err instanceof Error && /worker/i.test(err.message) && !mayTransfer) {
      ctx.warn(
        warn(
          'fallback-main-thread',
          'Parsing on the main thread; workers are unavailable.',
          'info',
        ),
      );
      return pipeline.transcode(input, ctx);
    }
    throw err;
  }
}

export interface LoadOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: ProgressReport;
  readonly quality?: QualityOptions;
}

export class UnsupportedFormatError extends Error {
  constructor(
    message: string,
    /** What detection thought it was, when it managed to decide at all. */
    readonly detected: FormatId | null,
  ) {
    super(message);
    this.name = 'UnsupportedFormatError';
  }
}

let nextId = 1;

const noopProgress: ProgressReport = () => {};

export async function loadAsset(input: LoadInput, options: LoadOptions = {}): Promise<LoadedModel> {
  const { primary } = input;
  const probe = makeProbe(primary.name, primary.bytes);
  const detection = detectFormat(probe, input.formatHint);

  if (detection.candidates.length === 0) {
    throw new UnsupportedFormatError(
      `Could not recognise "${primary.name}". Supported formats are ` +
        `${registry.ids().join(', ')} — use "Open as..." to force one.`,
      null,
    );
  }

  const implemented = detection.candidates.filter((id) => registry.has(id));
  if (implemented.length === 0) {
    const first = detection.candidates[0]!;
    const label = snifferFor(first)?.label ?? first;
    throw new UnsupportedFormatError(
      `"${primary.name}" looks like ${label}, which this build does not support yet.`,
      first,
    );
  }

  const onProgress = options.onProgress ?? noopProgress;
  const signal = options.signal ?? new AbortController().signal;
  const quality = options.quality ?? DEFAULT_QUALITY;

  let lastError: unknown = null;

  for (const [attempt, id] of implemented.entries()) {
    const descriptor = registry.get(id)!;
    const extra: LoadWarning[] = [];
    // A fallthrough means the best reading of the bytes did not parse; say so rather than
    // silently presenting the runner-up as if it had been the obvious answer.
    if (attempt > 0) {
      const rejected = implemented.slice(0, attempt).join(', ');
      extra.push(
        warn(
          'ambiguous-format',
          `This file did not parse as ${rejected}; it was read as ${id} instead.`,
          'info',
        ),
      );
    }

    // A fresh warning sink per attempt, so a failed candidate's warnings do not leak into
    // the one that eventually succeeds.
    const collected: LoadWarning[] = [...extra];
    const attemptCtx: LoadContext = { onProgress, signal, quality, warn: (w) => collected.push(w) };

    try {
      const pipeline = await descriptor.pipeline();
      let raw: RawAsset;
      let parseMs: number;

      if (pipeline.kind === 'geometry') {
        // Only the final candidate may transfer: an earlier one throwing has to leave the
        // bytes readable for the next attempt.
        const isLastCandidate = attempt === implemented.length - 1;
        const out = await runTranscode(id, pipeline, input, attemptCtx, isLastCandidate);
        raw = {
          object: buildScene(out.scene),
          units: out.units,
          sourceUpAxis: out.sourceUpAxis,
          orientation: out.orientation,
          warnings: [...collected, ...out.warnings],
        };
        parseMs = out.parseMs;
      } else {
        const started = performance.now();
        const loaded = await pipeline.load(input, attemptCtx);
        parseMs = performance.now() - started;
        raw = { ...loaded, warnings: [...collected, ...(loaded.warnings ?? [])] };
      }

      return finalize(raw, {
        id: nextId++,
        name: primary.name,
        format: id,
        bytes: primary.bytes.byteLength,
        parseMs,
      });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      lastError = err;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Could not open "${primary.name}": ${message}`);
}

/** Convenience for callers that have a single file and no companions. */
export function singleFileInput(
  name: string,
  bytes: ArrayBuffer,
  formatHint?: FormatId,
): LoadInput {
  const lower = name.toLowerCase();
  return {
    primary: { name: lower, path: lower, bytes },
    companions: new Map(),
    ...(formatHint ? { formatHint } : {}),
  };
}
