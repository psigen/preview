/**
 * The contract every format plugin fulfils, and everything downstream consumes.
 *
 * This is the load-bearing layer: it is deliberately built and tested before any plugin or
 * any WebGL exists, so the viewer can be written against real interfaces rather than
 * against a guess.
 */
import type { AnimationClip, Matrix4, Object3D } from 'three';
import type { FormatId } from '../format-id';
import type { UnitId } from '../units';
import type { Vec3 } from '../vec3';

/** What the SOURCE file declared. `LoadedModel.object` is always Y-up regardless. */
export type UpAxis = 'Y' | 'Z' | 'unknown';

/**
 * Whether a plugin has already oriented its own root.
 *
 * 'file' — the root is in the file's own orientation; the finaliser applies the correction.
 * 'y-up' — the loader did it itself (three's USDLoader rotates for a Z-up stage), so the
 *          finaliser must not do it a second time.
 */
export type Orientation = 'file' | 'y-up';

/**
 * How a world-space distance maps to a physical one.
 *
 * `metersPerUnit` converts a distance measured in the WORLD space of `LoadedModel.object`
 * (after updateMatrixWorld) into metres, AFTER any transform a loader already baked in. A
 * loader that bakes a unit scale into its own root must therefore report 1.
 *
 * Discriminated so the abstract branch cannot be forgotten: there are exactly two states,
 * declared or nothing. There is deliberately no "assumed" — guessing a scale would produce
 * a number that looks measured.
 */
export type UnitInfo =
  | {
      readonly known: true;
      readonly metersPerUnit: number;
      /** What the file was authored in, for display only. */
      readonly sourceUnit?: UnitId;
    }
  | {
      readonly known: false;
      /** Shown in the info panel, e.g. 'STL files do not record units.' */
      readonly reason: string;
    };

export const UNITS_UNKNOWN = (reason: string): UnitInfo => ({ known: false, reason });
export const UNITS_DECLARED = (metersPerUnit: number, sourceUnit?: UnitId): UnitInfo => ({
  known: true,
  metersPerUnit,
  ...(sourceUnit ? { sourceUnit } : {}),
});

export type WarningCode =
  | 'units-unknown'
  | 'up-axis-unknown'
  | 'missing-companion'
  | 'missing-texture'
  | 'texture-decode-unavailable'
  | 'unsupported-feature'
  | 'degenerate-geometry'
  | 'no-normals'
  | 'no-indices'
  | 'non-finite-geometry'
  | 'truncated'
  | 'large-file'
  | 'fallback-main-thread'
  | 'ambiguous-format';

export interface LoadWarning {
  readonly code: WarningCode;
  readonly message: string;
  readonly severity: 'info' | 'warning' | 'error';
}

export const warn = (
  code: WarningCode,
  message: string,
  severity: LoadWarning['severity'] = 'warning',
): LoadWarning => ({ code, message, severity });

export interface AssetStats {
  readonly meshes: number;
  readonly triangles: number;
  readonly vertices: number;
  /** Point-cloud vertices, e.g. a PLY with no faces. Counted separately from `vertices`. */
  readonly points: number;
  readonly materials: number;
  readonly textures: number;
  readonly animations: number;
  readonly hasNormals: boolean;
  readonly hasUVs: boolean;
  readonly hasVertexColors: boolean;
  /** WORLD-space axis-aligned bounds, in world units. Never recentred. */
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  /** bounds.max - bounds.min. */
  readonly size: Vec3;
  /** False when the model has no finite geometry — guards the camera against NaN. */
  readonly valid: boolean;
  /** Byte length of the source file. */
  readonly bytes: number;
  /** Wall-clock milliseconds spent inside the plugin. */
  readonly parseMs: number;
}

/** What a plugin returns, before the finaliser wraps and measures it. */
export interface RawAsset {
  /** The plugin's own root. Its transform is never modified by us. */
  readonly object: Object3D;
  readonly units: UnitInfo;
  readonly sourceUpAxis: UpAxis;
  readonly orientation: Orientation;
  readonly animations?: AnimationClip[];
  readonly warnings?: LoadWarning[];
  /** Disposables not reachable from `object` — object URLs, decoder instances. */
  dispose?(): void;
}

/** A model loaded, oriented, measured and ready to render. */
export interface LoadedModel {
  /** Monotonic. Doubles as a React key and an effect dependency. */
  readonly id: number;
  readonly name: string;
  readonly format: FormatId;
  /**
   * A wrapper Group, always Y-up. The plugin's own root is its child, so the app may
   * transform this freely without ever clobbering a unit scale a loader baked in.
   */
  readonly object: Object3D;
  readonly units: UnitInfo;
  /** What the file declared, for display. `object` is Y-up whatever this says. */
  readonly sourceUpAxis: UpAxis;
  /** world = worldFromFile * file. Invert it for a file-space coordinate readout. */
  readonly worldFromFile: Matrix4;
  readonly animations: readonly AnimationClip[];
  readonly stats: AssetStats;
  readonly warnings: readonly LoadWarning[];
  /** Releases geometries, materials, textures and any plugin-held resources. */
  dispose(): void;
}
