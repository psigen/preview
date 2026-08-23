/**
 * Test-facing view of the canonical box.
 *
 * The geometry itself lives in src/lib/samples/box.ts so the bundled sample models and the
 * fixtures cannot drift apart. Only the derived constants the tests assert against are
 * defined here.
 */
export {
  BOX_MM,
  UNIT_METERS as UNIT_M,
  TRIS,
  FACE_NORMALS,
  TRIANGLE_COUNT,
  VERTEX_COUNT,
  corners,
  extentsIn,
  soup,
} from '../../src/lib/samples/box';
export type { Extents, Triple as Vec3, UnitName } from '../../src/lib/samples/box';

/**
 * The space diagonal in METRES. THE cross-format invariant: a unitless STL, a Z-up 3MF in
 * inches, a metersPerUnit=0.01 USDA and an OCCT-tessellated STEP must all produce this.
 *
 * Compare with a tolerance, never exact equality — the inch round-trip through OCCT
 * accumulates ~6e-15 relative error (docs/SPIKES.md S1).
 */
export const DIAGONAL_M = Math.hypot(0.01, 0.02, 0.03);

/** The same diagonal for unitless formats, which carry the raw millimetre numbers. */
export const DIAGONAL_ABSTRACT = Math.hypot(10, 20, 30);
