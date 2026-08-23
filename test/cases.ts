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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extentsIn } from './gen/box';
import * as W from './gen/writers';

const fixture = (name: string): ArrayBuffer => {
  const b = readFileSync(join(import.meta.dirname, 'fixtures', name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const mm = extentsIn('millimeter');

export interface FormatCase {
  /** Test name. */
  readonly name: string;
  readonly format: FormatId;
  readonly fileName: string;
  readonly bytes: () => ArrayBuffer;
  /** Sidecars this case needs, keyed by the path the primary references. */
  readonly companions?: () => Map<string, ArrayBuffer>;
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

/**
 * The same physical box, in metres, as a unit-declaring format presents it. USD and glTF
 * both put world space in metres, so their bounds are the millimetre box divided by 1000.
 */
const METRIC_BOUNDS = { min: [0, 0, 0] as Vec3, max: [0.01, 0.02, 0.03] as Vec3 };

/** A Z-up stage rotated to Y-up: (x, y, z) -> (x, z, -y), so the box hangs below the origin. */
const METRIC_BOUNDS_FROM_Z_UP = {
  min: [0, 0, -0.03] as Vec3,
  max: [0.01, 0.02, 0] as Vec3,
};

/**
 * CAD is authored Z-up with the box at 10 x 20 x 30 mm, so after the same rotation the
 * height lands on Y: (x, y, z) -> (x, z, -y) maps 0.01 x 0.02 x 0.03 to 0.01 x 0.03 x 0.02.
 * Different bounds from the USD case, identical diagonal — which is the point.
 */
const CAD_BOUNDS_FROM_Z_UP = {
  min: [0, 0, -0.02] as Vec3,
  max: [0.01, 0.03, 0] as Vec3,
};

/** Every unitless triangle mesh of the canonical box shares these expectations. */
const unitlessMesh = (
  over: Partial<FormatCase> &
    Pick<FormatCase, 'name' | 'format' | 'fileName' | 'bytes' | 'strongSniff'>,
): FormatCase => ({
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
  {
    name: 'STEP declaring millimetres',
    format: 'step',
    fileName: 'box-mm.step',
    bytes: () => fixture('box-mm.step'),
    strongSniff: true,
    expectTriangles: 12,
    expectPoints: 0,
    expectMeshes: 1,
    expectBounds: CAD_BOUNDS_FROM_Z_UP,
    // OCCT is asked for metres and converts from whatever the file declared.
    expectMetersPerUnit: 1,
    expectSourceUpAxis: 'Z',
    expectBakedScale: 1,
    expectWarnings: [],
  },
  {
    name: 'IGES surfaces',
    format: 'iges',
    fileName: 'box-mm.igs',
    // Six untrimmed bilinear patches. Proves the OCCT IGES reader path and, with the STEP
    // pair, that both entry points land on the same physical box.
    bytes: () => fixture('box-mm.igs'),
    // Column 73 is a weak signal at best, so a renamed IGES is not expected to be found.
    strongSniff: false,
    expectTriangles: 12,
    expectPoints: 0,
    expectMeshes: 6,
    expectBounds: CAD_BOUNDS_FROM_Z_UP,
    expectMetersPerUnit: 1,
    expectSourceUpAxis: 'Z',
    expectBakedScale: 1,
    expectWarnings: [],
  },
  {
    name: 'STEP declaring inches',
    format: 'step',
    fileName: 'box-inch.step',
    // The same physical box, declared in inches. If OCCT ever stops reading a file's own
    // unit, this case and the millimetre one stop agreeing.
    bytes: () => fixture('box-inch.step'),
    strongSniff: true,
    expectTriangles: 12,
    expectPoints: 0,
    expectMeshes: 1,
    expectBounds: CAD_BOUNDS_FROM_Z_UP,
    expectMetersPerUnit: 1,
    expectSourceUpAxis: 'Z',
    expectBakedScale: 1,
    expectWarnings: [],
  },
  {
    name: 'GLB',
    format: 'gltf',
    fileName: 'box.glb',
    bytes: () => W.glb(extentsIn('meter')),
    strongSniff: true,
    expectTriangles: 12,
    expectPoints: 0,
    expectMeshes: 1,
    expectBounds: METRIC_BOUNDS,
    // The spec mandates metres; no field to read and nothing to assume.
    expectMetersPerUnit: 1,
    expectSourceUpAxis: 'Y',
    expectBakedScale: 1,
    expectWarnings: [],
  },
  {
    name: 'glTF with an external .bin',
    format: 'gltf',
    fileName: 'box.gltf',
    bytes: () => W.gltfSeparate(extentsIn('meter')).gltf,
    companions: () => {
      const { bin, binName } = W.gltfSeparate(extentsIn('meter'));
      return new Map([[binName, bin]]);
    },
    strongSniff: true,
    expectTriangles: 12,
    expectPoints: 0,
    expectMeshes: 1,
    expectBounds: METRIC_BOUNDS,
    expectMetersPerUnit: 1,
    expectSourceUpAxis: 'Y',
    expectBakedScale: 1,
    expectWarnings: [],
  },
  {
    name: 'USDA, metres, Y-up',
    format: 'usd',
    fileName: 'box-m.usda',
    bytes: () => W.usda(1, 'Y'),
    strongSniff: true,
    expectTriangles: 12,
    expectPoints: 0,
    expectMeshes: 1,
    expectBounds: METRIC_BOUNDS,
    expectMetersPerUnit: 1,
    expectSourceUpAxis: 'Y',
    expectBakedScale: 1,
    expectWarnings: [],
  },
  {
    name: 'USDA, centimetres, Y-up',
    format: 'usd',
    fileName: 'box-cm.usda',
    bytes: () => W.usda(0.01, 'Y'),
    strongSniff: true,
    expectTriangles: 12,
    expectPoints: 0,
    expectMeshes: 1,
    expectBounds: METRIC_BOUNDS,
    // Still 1: the loader already scaled the root, so world space is metres either way.
    expectMetersPerUnit: 1,
    expectSourceUpAxis: 'Y',
    // ...and that baked scale is visible here, which is exactly what must NOT be a fit scale.
    expectBakedScale: 0.01,
    expectWarnings: [],
  },
  {
    name: 'USDA, millimetres, Z-up',
    format: 'usd',
    fileName: 'box-mm-zup.usda',
    bytes: () => W.usda(0.001, 'Z'),
    strongSniff: true,
    expectTriangles: 12,
    expectPoints: 0,
    expectMeshes: 1,
    expectBounds: METRIC_BOUNDS_FROM_Z_UP,
    expectMetersPerUnit: 1,
    expectSourceUpAxis: 'Z',
    expectBakedScale: 0.001,
    expectWarnings: [],
  },
  {
    name: 'USDZ package',
    format: 'usd',
    fileName: 'box.usdz',
    bytes: () => W.usdz(0.001, 'Y'),
    strongSniff: true,
    expectTriangles: 12,
    expectPoints: 0,
    expectMeshes: 1,
    expectBounds: METRIC_BOUNDS,
    expectMetersPerUnit: 1,
    expectSourceUpAxis: 'Y',
    expectBakedScale: 0.001,
    expectWarnings: [],
  },
  unitlessMesh({
    name: 'OBJ without materials',
    format: 'obj',
    fileName: 'box.obj',
    bytes: () => W.objMtl(mm).obj,
    // The `v`/`f` shape is suggestive, not decisive, so a renamed OBJ is not expected.
    strongSniff: false,
    // The .mtl it names is absent, which is a warning rather than a failure.
    expectWarnings: ['missing-companion', 'units-unknown', 'up-axis-unknown'],
  }),
  unitlessMesh({
    name: 'OBJ with its MTL',
    format: 'obj',
    fileName: 'box.obj',
    bytes: () => W.objMtl(mm).obj,
    companions: () => {
      const { mtl, mtlName } = W.objMtl(mm);
      return new Map([[mtlName, mtl]]);
    },
    strongSniff: false,
    expectWarnings: ['units-unknown', 'up-axis-unknown'],
  }),
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
