/**
 * The canonical box: a 10 x 20 x 30 millimetre part with one corner at the origin.
 *
 * Single source of truth, shared by the bundled sample models and by every test fixture.
 * Chosen deliberately:
 *  - ASYMMETRIC, so an axis swap or a Z-up/Y-up mistake shows in the bounding box rather
 *    than hiding behind symmetry.
 *  - NOT origin-centred, so anything that silently recentres the model is visible.
 *  - 12 triangles / 8 vertices, so counts are exact.
 *  - Its space diagonal is rotation-invariant, which is what makes one number comparable
 *    across every format.
 */
import type { Vec3 } from '../vec3';

export const BOX_MM = Object.freeze({ x: 10, y: 20, z: 30 });

export interface Extents {
  x: number;
  y: number;
  z: number;
}

/** Metres per one unit of the named unit. */
export const UNIT_METERS = Object.freeze({
  micrometer: 1e-6,
  millimeter: 1e-3,
  centimeter: 1e-2,
  meter: 1,
  inch: 0.0254,
  foot: 0.3048,
});
export type UnitName = keyof typeof UNIT_METERS;

/** The box's extents expressed in `unit`. */
export function extentsIn(unit: UnitName): Extents {
  const s = 1e-3 / UNIT_METERS[unit];
  return { x: BOX_MM.x * s, y: BOX_MM.y * s, z: BOX_MM.z * s };
}

/** The 8 corners. Index bit0 = X, bit1 = Y, bit2 = Z. */
export function corners({ x, y, z }: Extents): Vec3[] {
  return [
    [0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0],
    [0, 0, z], [x, 0, z], [x, y, z], [0, y, z],
  ];
}

/** 12 triangles as corner-index triples, counter-clockwise seen from outside. */
export const TRIS: readonly Vec3[] = Object.freeze([
  [0, 3, 2], [0, 2, 1], // -Z
  [4, 5, 6], [4, 6, 7], // +Z
  [0, 1, 5], [0, 5, 4], // -Y
  [3, 7, 6], [3, 6, 2], // +Y
  [0, 4, 7], [0, 7, 3], // -X
  [1, 2, 6], [1, 6, 5], // +X
]);

/** Outward face normal per triangle, matching TRIS order. */
export const FACE_NORMALS: readonly Vec3[] = Object.freeze([
  [0, 0, -1], [0, 0, -1], [0, 0, 1], [0, 0, 1],
  [0, -1, 0], [0, -1, 0], [0, 1, 0], [0, 1, 0],
  [-1, 0, 0], [-1, 0, 0], [1, 0, 0], [1, 0, 0],
]);

export const TRIANGLE_COUNT = TRIS.length;
export const VERTEX_COUNT = 8;

/** Flat, non-indexed triangle soup: 36 vertices. */
export function soup(ext: Extents): Vec3[] {
  const c = corners(ext);
  const out: Vec3[] = [];
  for (const [a, b, d] of TRIS) out.push(c[a]!, c[b]!, c[d]!);
  return out;
}
