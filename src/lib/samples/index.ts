/**
 * Bundled sample models.
 *
 * Generated in code rather than committed as binaries: it sidesteps third-party licensing
 * entirely, keeps the repo small, and means the samples exercise exactly the same parsing
 * path the tests assert on. They are written as real STL and PLY bytes and fed through the
 * ordinary loader, so opening a sample is indistinguishable from opening a dropped file.
 */
import { BOX_MM, corners, extentsIn, FACE_NORMALS, TRIS, type Extents } from './box';

const enc = new TextEncoder();

function stlBinary(ext: Extents): ArrayBuffer {
  const c = corners(ext);
  const buf = new ArrayBuffer(84 + 50 * TRIS.length);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  u8.set(enc.encode('preview sample box').subarray(0, 80), 0);
  dv.setUint32(80, TRIS.length, true);
  let o = 84;
  TRIS.forEach((tri, i) => {
    const n = FACE_NORMALS[i]!;
    for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, n[k]!, true);
    o += 12;
    for (const vi of tri) {
      for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, c[vi]![k]!, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  });
  return buf;
}

function plyAscii(ext: Extents): ArrayBuffer {
  const c = corners(ext);
  let s =
    'ply\nformat ascii 1.0\nelement vertex 8\n' +
    'property float x\nproperty float y\nproperty float z\n' +
    'element face 12\nproperty list uchar int vertex_indices\nend_header\n';
  for (const v of c) s += `${v[0]} ${v[1]} ${v[2]}\n`;
  for (const t of TRIS) s += `3 ${t[0]} ${t[1]} ${t[2]}\n`;
  const bytes = enc.encode(s);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export interface SampleModel {
  readonly id: string;
  /** Shown in the picker. */
  readonly label: string;
  readonly fileName: string;
  bytes(): ArrayBuffer;
}

const scaled = (factor: number) => ({
  x: BOX_MM.x * factor,
  y: BOX_MM.y * factor,
  z: BOX_MM.z * factor,
});

/**
 * The same box at three world scales, spanning six orders of magnitude, plus a PLY.
 *
 * Because the camera derives every constant from the bounding-sphere radius and never
 * rescales the model, the three STL samples must frame IDENTICALLY — which is what
 * scripts/verify-viewer.mjs asserts, pixel for pixel. The PLY is not pixel-comparable with
 * them: it has no vertex normals, so buildScene derives smoothed ones at the shared corners
 * of an indexed box, where STL carries flat per-facet normals.
 */
export const SAMPLES: readonly SampleModel[] = [
  {
    id: 'stl-mm',
    label: 'Box, STL authored in millimetres',
    fileName: 'sample-box-mm.stl',
    bytes: () => stlBinary(extentsIn('millimeter')),
  },
  {
    id: 'stl-m',
    label: 'Box, STL authored in metres',
    fileName: 'sample-box-m.stl',
    bytes: () => stlBinary(extentsIn('meter')),
  },
  {
    id: 'stl-big',
    label: 'Box, STL at 1000x scale',
    fileName: 'sample-box-large.stl',
    bytes: () => stlBinary(scaled(1000)),
  },
  {
    id: 'ply',
    label: 'Box, PLY with faces',
    fileName: 'sample-box.ply',
    bytes: () => plyAscii(extentsIn('millimeter')),
  },
];

export function sampleById(id: string): SampleModel {
  return SAMPLES.find((s) => s.id === id) ?? SAMPLES[0]!;
}
