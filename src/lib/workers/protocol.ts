import type { ScenePayload } from '../asset/payload';
import type { LoadWarning, Orientation, UnitInfo, UpAxis } from '../asset/types';
import type { FormatId } from '../format-id';
import type { QualityOptions, TranscodeCounts } from '../registry/types';

/**
 * Messages between the main thread and the parse worker.
 *
 * Everything crossing the boundary is structured-cloneable, and the large parts are
 * transferred rather than copied: a 500 MB mesh must not be duplicated on its way in, and
 * the typed arrays must not be duplicated on the way back.
 */

export interface ParseRequest {
  readonly type: 'parse';
  readonly id: number;
  readonly format: FormatId;
  readonly fileName: string;
  /** Transferred: the caller must not touch it afterwards. */
  readonly bytes: ArrayBuffer;
  readonly companions: Readonly<Record<string, ArrayBuffer>>;
  readonly quality: QualityOptions;
  /**
   * The Open CASCADE wasm, for CAD formats only.
   *
   * Sent from the main thread because emscripten cannot locate its own wasm inside a module
   * worker — all three of its environment flags are false there (docs/SPIKES.md S2). Sent
   * once; the worker keeps it for the session.
   */
  readonly wasmBinary?: ArrayBuffer;
}

export type WorkerRequest = ParseRequest | { readonly type: 'cancel'; readonly id: number };

/** TranscodeOutput minus nothing — it is already plain data. */
export interface TranscodeResult {
  readonly scene: ScenePayload;
  readonly units: UnitInfo;
  readonly sourceUpAxis: UpAxis;
  readonly orientation: Orientation;
  readonly warnings: readonly LoadWarning[];
  readonly counts: TranscodeCounts;
  readonly parseMs: number;
}

export type WorkerResponse =
  | { readonly type: 'progress'; readonly id: number; readonly phase: string; readonly ratio: number | null }
  | { readonly type: 'result'; readonly id: number; readonly out: TranscodeResult }
  /** Errors cross as plain fields: an Error does not structured-clone its stack reliably. */
  | { readonly type: 'error'; readonly id: number; readonly name: string; readonly message: string };

export type PostMessage = (response: WorkerResponse, transfer?: ArrayBuffer[]) => void;
