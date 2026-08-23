/**
 * The coverage table.
 *
 * Every registered format must appear here, and a test asserts that — so adding a plugin
 * without a fixture is impossible. Each case pins the same physical object, so the numbers
 * are directly comparable across formats and a mistake shows up as exactly one row
 * disagreeing with all the others.
 */
import type { WarningCode } from '../src/lib/asset/types';
import type { FormatId } from '../src/lib/format-id';
import type { Vec3 } from '../src/lib/vec3';
import { extentsIn } from './gen/box';
import * as W from './gen/writers';

const mm = extentsIn('millimeter');

export interface FormatCase {
  /** Test name. */
  readonly name: string;
  readonly format: FormatId;
  readonly fileName: string;
  readonly bytes: () => ArrayBuffer;
  /** Whether detection must still succeed when the file is renamed to blob.dat. */
  readonly strongSniff: boolean;
  readonly expectTriangles: number;
  readonly expectPoints: number;
  readonly expectMeshes: number;
  readonly expectBounds: { readonly min: Vec3; readonly max: Vec3 };
  /** null when the format declares no units. */
  readonly expectMetersPerUnit: number | null;
  readonly expectSourceUpAxis: 'Y' | 'Z' | 'unknown';
  /** The uniform scale worldFromFile must decompose to. Never a fit or normalisation scale. */
  readonly expectBakedScale: number;
  /** Exact set, sorted. Asserting the whole set stops a warning being silently dropped. */
  readonly expectWarnings: readonly WarningCode[];
}

const BOX_BOUNDS = { min: [0, 0, 0] as Vec3, max: [10, 20, 30] as Vec3 };

/** Every unitless triangle mesh of the canonical box shares these expectations. */
const unitlessMesh = (over: Partial<FormatCase> & Pick<FormatCase, 'name' | 'format' | 'fileName' | 'bytes' | 'strongSniff'>): FormatCase => ({
  expectTriangles: 12,
  expectPoints: 0,
  expectMeshes: 1,
  expectBounds: BOX_BOUNDS,
  expectMetersPerUnit: null,
  expectSourceUpAxis: 'unknown',
  expectBakedScale: 1,
  expectWarnings: ['units-unknown', 'up-axis-unknown'],
  ...over,
});

export const CASES: readonly FormatCase[] = [
  unitlessMesh({
    name: 'STL ascii',
    format: 'stl',
    fileName: 'box-ascii.stl',
    bytes: () => W.stlAscii(mm),
    // ASCII STL is only a weak sniff: "solid" plus a facet line is suggestive, not decisive.
    strongSniff: false,
  }),
  unitlessMesh({
    name: 'STL binary',
    format: 'stl',
    fileName: 'box-binary.stl',
    bytes: () => W.stlBinary(mm),
    strongSniff: true,
  }),
  unitlessMesh({
    name: 'STL binary with a "solid" header',
    format: 'stl',
    fileName: 'box-trap.stl',
    // The adversarial case: many exporters write literal ASCII "solid ..." into a BINARY
    // STL's 80-byte header, which defeats any text-first ascii/binary check.
    bytes: () => W.stlBinary(mm, 'solid this is really a binary stl'),
    strongSniff: true,
  }),
  unitlessMesh({
    name: 'PLY ascii',
    format: 'ply',
    fileName: 'box-ascii.ply',
    bytes: () => W.plyAscii(mm),
    strongSniff: true,
    expectWarnings: ['no-normals', 'units-unknown', 'up-axis-unknown'],
  }),
  unitlessMesh({
    name: 'PLY binary little-endian',
    format: 'ply',
    fileName: 'box-le.ply',
    bytes: () => W.plyBinary(mm, true),
    strongSniff: true,
    expectWarnings: ['no-normals', 'units-unknown', 'up-axis-unknown'],
  }),
  unitlessMesh({
    name: 'PLY binary big-endian',
    format: 'ply',
    fileName: 'box-be.ply',
    // Works despite three's loader only naming the little-endian format string: it passes
    // the negation into DataView.getFloat32(offset, littleEndian).
    bytes: () => W.plyBinary(mm, false),
    strongSniff: true,
    expectWarnings: ['no-normals', 'units-unknown', 'up-axis-unknown'],
  }),
  unitlessMesh({
    name: 'PLY point cloud',
    format: 'ply',
    fileName: 'box-points.ply',
    bytes: () => W.plyPoints(mm),
    strongSniff: true,
    // No faces: drawn as points, so no triangles and no mesh.
    expectTriangles: 0,
    expectPoints: 8,
    expectMeshes: 0,
    expectWarnings: ['no-indices', 'units-unknown', 'up-axis-unknown'],
  }),
];
