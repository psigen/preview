/**
 * The plugin contract.
 *
 * Two kinds, and the discriminant is load-bearing: the worker entry point will only ever
 * import the `geometry` registry, so a `scene` plugin cannot be routed into a worker by
 * mistake — which matters because every `scene` format needs the DOM for something
 * (textures, DOMParser, window) and would fail there at runtime.
 */
import type { FormatId } from '../format-id';
import type { ScenePayload } from '../asset/payload';
import type { LoadWarning, Orientation, RawAsset, UnitInfo, UpAxis } from '../asset/types';

/** Tessellation quality, for formats that convert curved surfaces into triangles. */
export interface QualityOptions {
  readonly cad: {
    readonly linearDeflectionType: 'bounding_box_ratio' | 'absolute_value';
    readonly linearDeflection: number;
    readonly angularDeflection: number;
  };
}

export const DEFAULT_QUALITY: QualityOptions = Object.freeze({
  cad: Object.freeze({
    linearDeflectionType: 'bounding_box_ratio' as const,
    linearDeflection: 0.001,
    angularDeflection: 0.5,
  }),
});

/** What a format can carry, for the info panel and the licences page. */
export interface FormatCapabilities {
  /** Does the format record a unit, so the ruler can report real lengths? */
  readonly declaresUnits: boolean;
  readonly declaresUpAxis: boolean;
  readonly materials: boolean;
  readonly textures: boolean;
  readonly animations: boolean;
  /** Needs sibling files (.mtl, .bin, images) to load completely. */
  readonly usesCompanions: boolean;
  /** Surfaced in the About panel; only occt-import-js is not MIT. */
  readonly license?: 'MIT' | 'LGPL-2.1';
}

/* ------------------------------------------------------------------ input */

export interface AssetFile {
  /** Lower-cased basename, e.g. 'part.stl'. */
  readonly name: string;
  /** Lower-cased path relative to the drop root; defaults to `name`. */
  readonly path: string;
  readonly bytes: ArrayBuffer;
}

export interface LoadInput {
  readonly primary: AssetFile;
  /** Siblings from a multi-file or directory drop, keyed by normalised relative path. */
  readonly companions: ReadonlyMap<string, AssetFile>;
  /** An explicit "Open as..." override; skips detection entirely. */
  readonly formatHint?: FormatId;
}

export interface ProgressReport {
  (phase: string, ratio: number | null): void;
}

/** Everything a pipeline may need that is not the bytes themselves. */
export interface LoadContext {
  onProgress: ProgressReport;
  warn(w: LoadWarning): void;
  readonly signal: AbortSignal;
  readonly quality: QualityOptions;
}

/* --------------------------------------------------- geometry (transcode) */

export interface TranscodeCounts {
  readonly meshes: number;
  readonly triangles: number;
  readonly vertices: number;
  readonly points: number;
}

export interface TranscodeOutput {
  readonly scene: ScenePayload;
  readonly units: UnitInfo;
  readonly sourceUpAxis: UpAxis;
  readonly orientation: Orientation;
  readonly warnings: readonly LoadWarning[];
  readonly counts: TranscodeCounts;
  readonly parseMs: number;
}

/**
 * Bytes in, transferable typed arrays out.
 *
 * MUST NOT touch document, window, Image or DOMParser: this runs inside a worker, or inline
 * on the caller's thread when workers are unavailable, and the inline path is what the test
 * suite exercises — so tests run production code rather than a parallel implementation.
 */
export interface GeometryPipeline {
  readonly kind: 'geometry';
  transcode(input: LoadInput, ctx: LoadContext): Promise<TranscodeOutput>;
}

/* ------------------------------------------------------- scene (direct) */

/** Returns a three Object3D on the main thread. May use the DOM. */
export interface ScenePipeline {
  readonly kind: 'scene';
  load(input: LoadInput, ctx: LoadContext): Promise<RawAsset>;
}

export type FormatPipeline = GeometryPipeline | ScenePipeline;

/* ---------------------------------------------------------------- registry */

/**
 * Registered eagerly, so the registry is cheap to import and enumerate.
 *
 * A descriptor MUST NOT statically import three, a loader, or any wasm — everything heavy
 * sits behind `pipeline()`, which is a dynamic import. A source-text test enforces this,
 * because it is the difference between a 300 kB initial bundle and a 10 MB one.
 */
export interface FormatDescriptor {
  readonly id: FormatId;
  readonly capabilities: FormatCapabilities;
  pipeline(): Promise<FormatPipeline>;
}

export interface Registry {
  list(): readonly FormatDescriptor[];
  get(id: FormatId): FormatDescriptor | undefined;
  has(id: FormatId): boolean;
  ids(): readonly FormatId[];
}
