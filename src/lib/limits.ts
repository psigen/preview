/**
 * Size and complexity budgets, and the honest degradation they drive.
 *
 * These are not arbitrary. 100M triangles is not a reachable target in a browser: indexed,
 * that alone is >1.2 GB of Uint32 indices plus ~600 MB of Float32 positions, past practical
 * ArrayBuffer and GPU limits. Realistic ceilings are roughly 10-20M triangles on a discrete
 * GPU and 2-5M on integrated or mobile. So we budget and degrade rather than pretend.
 */

export const LIMITS = Object.freeze({
  /**
   * Warn BEFORE reading the bytes. Once a parse of a 500 MB STL is underway there is no
   * recovery path — the tab simply dies — so this pre-flight check is the single highest
   * value-per-line safety measure in the app.
   */
  warnFileBytes: 250 * 1024 * 1024,

  /** Above this, interaction gets sluggish; warn but behave normally. */
  softTriangles: 2_000_000,
  /** Above this, disable hover-driven features and say so. */
  hardTriangles: 20_000_000,

  /** Below this a linear raycast is already sub-millisecond, so a BVH is not worth building. */
  bvhMinTriangles: 25_000,
  /** A BVH costs roughly 30-40 bytes per triangle; 8M is already ~300 MB of tree. */
  bvhMaxTriangles: 8_000_000,

  maxMeasurements: 200,
  /** Snap radius, in screen pixels, so snapping feels the same at every zoom level. */
  snapPx: 12,
  /** Movement beyond this during a pointer gesture makes it a drag, not a click. */
  dragPx: 4,
} as const);

export type LoadLevel = 'ok' | 'warn' | 'heavy';

export interface Assessment {
  readonly level: LoadLevel;
  readonly messages: string[];
  /** Whether hover-driven picking should be disabled for this model. */
  readonly disableHover: boolean;
  /** Whether a BVH should be built at all. */
  readonly useBvh: boolean;
}

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/** Pre-flight check on the raw file, before any bytes are parsed. */
export function assessFileSize(bytes: number): { tooBig: boolean; message: string | null } {
  if (bytes < LIMITS.warnFileBytes) return { tooBig: false, message: null };
  return {
    tooBig: true,
    message:
      `This file is ${mb(bytes)} MB. Loading it may use several GB of memory and could crash ` +
      `the tab. Load it anyway, or try a decimated export instead.`,
  };
}

/** Post-parse assessment, driving warnings and feature degradation. */
export function assessModel(triangles: number, bytes: number): Assessment {
  const messages: string[] = [];
  let level: LoadLevel = 'ok';

  if (triangles >= LIMITS.hardTriangles) {
    level = 'heavy';
    messages.push(
      `${triangles.toLocaleString('en-US')} triangles is past what stays interactive. ` +
        `Hover preview is off; measurement still works on click.`,
    );
  } else if (triangles >= LIMITS.softTriangles) {
    level = 'warn';
    messages.push(`Large model (${triangles.toLocaleString('en-US')} triangles) — interaction may be slow.`);
  }

  if (triangles > LIMITS.bvhMaxTriangles) {
    messages.push('Too large to index for fast picking; clicks will be slower to register.');
  }

  if (bytes >= LIMITS.warnFileBytes) {
    messages.push(`Source file was ${mb(bytes)} MB; memory use will stay high while it is open.`);
  }

  return {
    level,
    messages,
    disableHover: triangles >= LIMITS.hardTriangles || triangles > LIMITS.bvhMaxTriangles,
    useBvh: triangles >= LIMITS.bvhMinTriangles && triangles <= LIMITS.bvhMaxTriangles,
  };
}
