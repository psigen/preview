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

/** A minimal GLB: JSON chunk + BIN chunk, hand-built so nothing depends on an exporter. */
function glb(ext: Extents): ArrayBuffer {
  const c = corners(ext);
  const pos = new Float32Array(36 * 3);
  const nrm = new Float32Array(36 * 3);
  let o = 0;
  TRIS.forEach((tri, t) => {
    for (const vi of tri) {
      pos.set(c[vi]!, o);
      nrm.set(FACE_NORMALS[t]!, o);
      o += 3;
    }
  });
  const bin = new Uint8Array(pos.byteLength + nrm.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(nrm.buffer), pos.byteLength);
  const json = JSON.stringify({
    asset: { version: '2.0', generator: 'preview samples' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'box' }],
    meshes: [{ name: 'box', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, mode: 4 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 36,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [ext.x, ext.y, ext.z],
      },
      { bufferView: 1, componentType: 5126, count: 36, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: nrm.byteLength, target: 34962 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  });
  const jsonBytes = enc.encode(json);
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let p = 12;
  dv.setUint32(p, jsonBytes.length + jsonPad, true);
  dv.setUint32(p + 4, 0x4e4f534a, true);
  p += 8;
  u8.set(jsonBytes, p);
  u8.fill(0x20, p + jsonBytes.length, p + jsonBytes.length + jsonPad);
  p += jsonBytes.length + jsonPad;
  dv.setUint32(p, bin.length + binPad, true);
  dv.setUint32(p + 4, 0x004e4942, true);
  p += 8;
  u8.set(bin, p);
  return buf;
}

/**
 * A USDA stage declaring millimetres and Z-up, so the sample exercises both conversions.
 *
 * Authored plainly — 10 x 20 x 30 with the height on Z, exactly as a Z-up tool would write
 * it. The test fixture in test/gen deliberately pre-swaps its extents so that world bounds
 * stay comparable across formats; a SAMPLE should not, because then its reported
 * as-authored dimensions would disagree with the STEP sample of the same box.
 */
function usda(metersPerUnit: number, upAxis: 'Y' | 'Z'): ArrayBuffer {
  const s = 1e-3 / metersPerUnit;
  const e: Extents = { x: BOX_MM.x * s, y: BOX_MM.y * s, z: BOX_MM.z * s };
  const pts = corners(e)
    .map((v) => `(${v[0]}, ${v[1]}, ${v[2]})`)
    .join(', ');
  const bytes = enc.encode(`#usda 1.0
(
    defaultPrim = "box"
    metersPerUnit = ${metersPerUnit}
    upAxis = "${upAxis}"
)

def Mesh "box"
{
    int[] faceVertexCounts = [${TRIS.map(() => 3).join(', ')}]
    int[] faceVertexIndices = [${TRIS.flat().join(', ')}]
    point3f[] points = [${pts}]
    uniform token subdivisionScheme = "none"
}
`);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * An OBJ and its MTL. Returned as a pair because the point of the sample is the companion
 * path: the OBJ is inert grey without it.
 */
function objWithMtl(ext: Extents): { obj: ArrayBuffer; mtl: ArrayBuffer } {
  const c = corners(ext);
  let o = 'mtllib box.mtl\no box\nusemtl boxmat\n';
  for (const v of c) o += `v ${v[0]} ${v[1]} ${v[2]}\n`;
  for (const t of TRIS) o += `f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}\n`;
  const mtl = 'newmtl boxmat\nKd 0.80 0.35 0.20\nKs 0.10 0.10 0.10\nNs 32.0\nd 1.0\nillum 2\n';
  const bytes = (text: string) => {
    const b = enc.encode(text);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  return { obj: bytes(o), mtl: bytes(mtl) };
}

export interface SampleModel {
  readonly id: string;
  /** Shown in the picker. */
  readonly label: string;
  readonly fileName: string;
  /** Generated in code. Mutually exclusive with `url`. */
  bytes?(): ArrayBuffer;
  /**
   * Served from public/samples instead, for anything too large or too fiddly to generate —
   * a STEP B-rep is 10 kB of text that would otherwise sit in the bundle for everyone.
   * Same-origin, so the app still makes no external request.
   */
  readonly url?: string;
  /** Sidecars this sample needs, keyed by the path the primary references. */
  companions?(): Map<string, ArrayBuffer>;
}

/** Resolve a sample to bytes, whether it is generated or served. */
export async function sampleBytes(sample: SampleModel): Promise<ArrayBuffer> {
  if (sample.bytes) return sample.bytes();
  if (!sample.url) throw new Error(`sample "${sample.id}" has neither bytes nor a url`);
  const base = import.meta.env.BASE_URL || './';
  const response = await fetch(new URL(`${base}${sample.url}`, window.location.href));
  if (!response.ok) throw new Error(`Could not load the ${sample.label} sample.`);
  return response.arrayBuffer();
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
 * scripts/verify-viewer.js asserts, pixel for pixel. The PLY is not pixel-comparable with
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
    id: 'glb',
    label: 'Box, GLB (metres, per the glTF spec)',
    fileName: 'sample-box.glb',
    bytes: () => glb(extentsIn('meter')),
  },
  {
    id: 'usda',
    label: 'Box, USD stage in millimetres, Z-up',
    fileName: 'sample-box.usda',
    bytes: () => usda(0.001, 'Z'),
  },
  {
    id: 'obj',
    label: 'Box, OBJ with a companion MTL',
    fileName: 'sample-box.obj',
    bytes: () => objWithMtl(extentsIn('millimeter')).obj,
    companions: () => new Map([['box.mtl', objWithMtl(extentsIn('millimeter')).mtl]]),
  },
  {
    id: 'step',
    label: 'Box, STEP solid in millimetres (CAD)',
    fileName: 'sample-box.step',
    url: 'samples/box-mm.step',
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
