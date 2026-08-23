/**
 * In-memory writers for the canonical box, one per container format.
 *
 * Generated rather than committed so there is nothing to go stale, and so the generator
 * doubles as executable documentation of each container's layout. A generator bug cannot
 * hide: the same physical box must yield the same bounds, the same 12 triangles and the
 * same diagonal across every format, so a mistake shows up as exactly one format
 * disagreeing with all the others.
 */
// fflate ships inside three, so the ZIP writers add no dependency.
import { zipSync } from 'three/addons/libs/fflate.module.js';
import { corners, TRIS, FACE_NORMALS, soup, type Extents } from './box';

const enc = new TextEncoder();

/* --------------------------------------------------------------------- STL */

export function stlAscii(ext: Extents): ArrayBuffer {
  const c = corners(ext);
  let s = 'solid box\n';
  TRIS.forEach((t, i) => {
    const n = FACE_NORMALS[i]!;
    s += `facet normal ${n[0]} ${n[1]} ${n[2]}\n  outer loop\n`;
    for (const vi of t) s += `    vertex ${c[vi]![0]} ${c[vi]![1]} ${c[vi]![2]}\n`;
    s += '  endloop\nendfacet\n';
  });
  return toArrayBuffer(enc.encode(`${s}endsolid box\n`));
}

/**
 * @param headerText the 80-byte header. Pass a string starting with 'solid' to build the
 * adversarial fixture that defeats a naive text-based ASCII/binary check.
 */
export function stlBinary(ext: Extents, headerText = 'preview canonical box'): ArrayBuffer {
  const c = corners(ext);
  const buf = new ArrayBuffer(84 + 50 * TRIS.length);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  u8.set(enc.encode(headerText).subarray(0, 80), 0);
  dv.setUint32(80, TRIS.length, true);
  let o = 84;
  TRIS.forEach((t, i) => {
    const n = FACE_NORMALS[i]!;
    for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, n[k]!, true);
    o += 12;
    for (const vi of t) {
      for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, c[vi]![k]!, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  });
  return buf;
}

/* --------------------------------------------------------------------- PLY */

const PLY_HEADER = (fmt: string) =>
  `ply\nformat ${fmt} 1.0\nelement vertex 8\n` +
  `property float x\nproperty float y\nproperty float z\n` +
  `element face 12\nproperty list uchar int vertex_indices\nend_header\n`;

export function plyAscii(ext: Extents): ArrayBuffer {
  const c = corners(ext);
  let s = PLY_HEADER('ascii');
  for (const v of c) s += `${v[0]} ${v[1]} ${v[2]}\n`;
  for (const t of TRIS) s += `3 ${t[0]} ${t[1]} ${t[2]}\n`;
  return toArrayBuffer(enc.encode(s));
}

export function plyBinary(ext: Extents, littleEndian = true): ArrayBuffer {
  const c = corners(ext);
  const header = enc.encode(
    PLY_HEADER(littleEndian ? 'binary_little_endian' : 'binary_big_endian'),
  );
  const body = new ArrayBuffer(8 * 12 + 12 * 13);
  const dv = new DataView(body);
  let o = 0;
  for (const v of c) {
    for (let k = 0; k < 3; k++) {
      dv.setFloat32(o, v[k]!, littleEndian);
      o += 4;
    }
  }
  for (const t of TRIS) {
    dv.setUint8(o, 3);
    o += 1;
    for (const idx of t) {
      dv.setInt32(o, idx, littleEndian);
      o += 4;
    }
  }
  const out = new Uint8Array(header.length + body.byteLength);
  out.set(header, 0);
  out.set(new Uint8Array(body), header.length);
  return toArrayBuffer(out);
}

/**
 * A PLY with vertices but NO face element. PLYLoader emits no index for one of these, which
 * is how the pipeline knows to draw points rather than triangles.
 */
export function plyPoints(ext: Extents): ArrayBuffer {
  const c = corners(ext);
  let s =
    `ply\nformat ascii 1.0\nelement vertex 8\n` +
    `property float x\nproperty float y\nproperty float z\n` +
    `property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
  c.forEach((v, i) => {
    s += `${v[0]} ${v[1]} ${v[2]} ${i * 30} ${255 - i * 30} 128\n`;
  });
  return toArrayBuffer(enc.encode(s));
}

/* ---------------------------------------------------------------- OBJ + MTL */

export function objMtl(ext: Extents): { obj: ArrayBuffer; mtl: ArrayBuffer; mtlName: string } {
  const c = corners(ext);
  let o = 'mtllib box.mtl\no box\nusemtl boxmat\n';
  for (const v of c) o += `v ${v[0]} ${v[1]} ${v[2]}\n`;
  for (const t of TRIS) o += `f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}\n`;
  const mtl = 'newmtl boxmat\nKd 0.80 0.35 0.20\nKs 0.10 0.10 0.10\nNs 32.0\nd 1.0\nillum 2\n';
  return {
    obj: toArrayBuffer(enc.encode(o)),
    mtl: toArrayBuffer(enc.encode(mtl)),
    mtlName: 'box.mtl',
  };
}

/* --------------------------------------------------------------- glTF / GLB */

/**
 * Hand-written rather than produced by GLTFExporter: Node has neither `document` nor
 * `OffscreenCanvas`, and this keeps the fixture bytes fully deterministic (SPIKES.md S6).
 */
function gltfParts(ext: Extents) {
  const pos = new Float32Array(soup(ext).flat());
  const nrm = new Float32Array(36 * 3);
  FACE_NORMALS.forEach((n, i) => {
    for (let v = 0; v < 3; v++) nrm.set(n, (i * 3 + v) * 3);
  });
  const bin = new Uint8Array(pos.byteLength + nrm.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(nrm.buffer), pos.byteLength);
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'preview test fixtures' },
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
    buffers: [{ byteLength: bin.byteLength } as Record<string, unknown>],
  };
  return { json, bin };
}

/** A .gltf plus an external .bin — exercises companion resolution. */
export function gltfSeparate(
  ext: Extents,
  binName = 'box.bin',
): { gltf: ArrayBuffer; bin: ArrayBuffer; binName: string } {
  const { json, bin } = gltfParts(ext);
  (json.buffers as Record<string, unknown>[])[0]!.uri = binName;
  return {
    gltf: toArrayBuffer(enc.encode(JSON.stringify(json, null, 2))),
    bin: toArrayBuffer(bin),
    binName,
  };
}

export function glb(ext: Extents): ArrayBuffer {
  const { json, bin } = gltfParts(ext);
  const jsonBytes = enc.encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let o = 12;
  dv.setUint32(o, jsonBytes.length + jsonPad, true);
  dv.setUint32(o + 4, 0x4e4f534a, true); // 'JSON'
  o += 8;
  u8.set(jsonBytes, o);
  u8.fill(0x20, o + jsonBytes.length, o + jsonBytes.length + jsonPad); // pad with spaces
  o += jsonBytes.length + jsonPad;
  dv.setUint32(o, bin.length + binPad, true);
  dv.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
  o += 8;
  u8.set(bin, o);
  return buf;
}

/* -------------------------------------------------------------------- USDA */

/**
 * @param metersPerUnit the declared scale.
 * @param upAxis 'Y' or 'Z'. For a Z-up file the physical height axis is Z, so the Y and Z
 * extents are swapped in file space — after USDLoader's -PI/2 rotation the world-space box
 * must come back out as 10 x 20 x 30 mm, identical to the Y-up variant.
 */
export function usda(metersPerUnit: number, upAxis: 'Y' | 'Z'): ArrayBuffer {
  const s = 1e-3 / metersPerUnit;
  const base = { x: 10 * s, y: 20 * s, z: 30 * s };
  const e: Extents = upAxis === 'Z' ? { x: base.x, y: base.z, z: base.y } : base;
  const pts = corners(e)
    .map((v) => `(${v[0]}, ${v[1]}, ${v[2]})`)
    .join(', ');
  return toArrayBuffer(
    enc.encode(`#usda 1.0
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
`),
  );
}

/* ------------------------------------------------------------------ helpers */

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
    ? (u8.buffer as ArrayBuffer)
    : (u8.slice().buffer as ArrayBuffer);
}

/* ------------------------------------------------------- USDZ / 3MF (ZIP) */

/**
 * USDZ is an uncompressed ZIP whose FIRST entry is the root layer. Not byte-for-byte
 * spec-strict (real USDZ wants 64-byte alignment, which USDLoader never checks), but it is
 * a valid archive and exercises the same detection and unzip paths.
 */
export function usdz(metersPerUnit: number, upAxis: 'Y' | 'Z'): ArrayBuffer {
  const layer = new Uint8Array(usda(metersPerUnit, upAxis));
  return toArrayBuffer(zipSync({ 'box.usda': layer }, { level: 0 }));
}

const THREEMF_CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
  `</Types>`;

const THREEMF_RELS =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Target="/3D/3dmodel.model" Id="rel0" ` +
  `Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

/** @param unit the declared 3MF unit. 3MF is Z-up, so Y and Z extents are swapped in file space. */
export function threemf(unit: 'millimeter' | 'inch' | 'meter'): ArrayBuffer {
  const perUnit = { millimeter: 1e-3, inch: 0.0254, meter: 1 }[unit];
  const s = 1e-3 / perUnit;
  const e: Extents = { x: 10 * s, y: 30 * s, z: 20 * s }; // Z-up: height goes on Z
  const verts = corners(e)
    .map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`)
    .join('');
  const tris = TRIS.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('');
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="${unit}" xml:lang="en-US" ` +
    `xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<resources><object id="1" type="model"><mesh>` +
    `<vertices>${verts}</vertices><triangles>${tris}</triangles>` +
    `</mesh></object></resources>` +
    `<build><item objectid="1"/></build></model>`;
  return toArrayBuffer(
    zipSync({
      '[Content_Types].xml': enc.encode(THREEMF_CONTENT_TYPES),
      '_rels/.rels': enc.encode(THREEMF_RELS),
      '3D/3dmodel.model': enc.encode(model),
    }),
  );
}

/** A minimal crate header. Enough for DETECTION tests; not a parseable USDC. */
export function usdcMagicOnly(): ArrayBuffer {
  const u8 = new Uint8Array(64);
  u8.set(enc.encode('PXR-USDC'), 0);
  u8[8] = 0;
  u8[9] = 8;
  u8[10] = 0; // version 0.8.0
  return toArrayBuffer(u8);
}

/** A minimal binary-FBX header. Enough for DETECTION tests; not a parseable FBX. */
export function fbxBinaryMagicOnly(): ArrayBuffer {
  const u8 = new Uint8Array(64);
  u8.set(enc.encode('Kaydara FBX Binary  '), 0);
  u8[20] = 0x00;
  u8[21] = 0x1a;
  u8[22] = 0x00;
  new DataView(u8.buffer).setUint32(23, 7400, true); // version 7.4
  return toArrayBuffer(u8);
}
