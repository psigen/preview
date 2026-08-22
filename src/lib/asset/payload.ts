/**
 * The intermediate representation produced by the transcode phase.
 *
 * `ScenePayload` is deliberately three-free and structured-cloneable, so a geometry plugin
 * can run inside a Web Worker and hand its typed arrays back by transfer rather than copy.
 * `buildScene` is the ONLY place it meets three, and it is pure, synchronous and Node-safe.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  type Material,
} from 'three';

/** 16 numbers, column-major — the same order as THREE.Matrix4.elements. */
export type Mat4Array = Float64Array;

export type Topology = 'triangles' | 'points' | 'lines';

export interface MeshGroup {
  readonly start: number;
  readonly count: number;
  readonly materialIndex: number;
}

export interface MeshPayload {
  readonly name: string;
  /** xyz triples. Required. */
  readonly positions: Float32Array;
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  /** rgb triples in LINEAR space. */
  readonly colors?: Float32Array;
  /**
   * Always Uint32Array. WebGL2 has universal 32-bit index support, so the old 65535 cliff
   * never applies and there is no reason to carry two index types through the pipeline.
   */
  readonly indices?: Uint32Array;
  /** Multi-material draw ranges. OCCT's brep_faces map straight onto these. */
  readonly groups?: readonly MeshGroup[];
  /** Single-material shorthand, used when `groups` is absent. */
  readonly materialIndex?: number;
  readonly topology: Topology;
}

export interface NodePayload {
  readonly name: string;
  /** Index into ScenePayload.nodes; -1 for the root. */
  readonly parent: number;
  /** Local matrix, column-major. Absent means identity. */
  readonly matrix?: Mat4Array;
  /** Indices into ScenePayload.meshes. */
  readonly meshes: readonly number[];
}

export interface MaterialPayload {
  readonly name?: string;
  /** Linear rgb, each channel 0..1. */
  readonly color?: readonly [number, number, number];
  readonly opacity?: number;
  readonly metalness?: number;
  readonly roughness?: number;
  readonly doubleSided?: boolean;
  readonly vertexColors?: boolean;
  readonly flatShading?: boolean;
}

export interface ScenePayload {
  /** nodes[0] is the root. */
  readonly nodes: readonly NodePayload[];
  readonly meshes: readonly MeshPayload[];
  readonly materials: readonly MaterialPayload[];
}

/* --------------------------------------------------------------- defaults */

/**
 * The neutral grey used when a format carries no material at all — STL, most PLY, raw CAD.
 * Double-sided because CAD exports routinely have inconsistent winding, and a single-sided
 * default makes half the part invisible, which reads as data corruption rather than a
 * display setting.
 */
export const DEFAULT_MATERIAL: MaterialPayload = Object.freeze({
  name: 'default',
  color: [0.725, 0.753, 0.8] as const,
  metalness: 0.05,
  roughness: 0.65,
  doubleSided: true,
});

/* ------------------------------------------------------------ transferables */

/**
 * Every distinct ArrayBuffer backing the payload, for a worker postMessage transfer list.
 *
 * Deduped by buffer identity: passing the same ArrayBuffer twice in a transfer list throws,
 * and several attributes may share one buffer when a plugin sub-arrays a single allocation.
 */
export function collectTransferables(payload: ScenePayload): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  const take = (view?: ArrayBufferView) => {
    if (!view) return;
    const buf = view.buffer;
    if (buf instanceof ArrayBuffer) seen.add(buf);
  };
  for (const m of payload.meshes) {
    take(m.positions);
    take(m.normals);
    take(m.uvs);
    take(m.colors);
    take(m.indices);
  }
  for (const n of payload.nodes) take(n.matrix);
  return [...seen];
}

/* --------------------------------------------------------------- buildScene */

function buildMaterial(spec: MaterialPayload, topology: Topology): Material {
  const color = spec.color ? new Color(spec.color[0], spec.color[1], spec.color[2]) : undefined;
  const transparent = spec.opacity !== undefined && spec.opacity < 1;

  if (topology === 'points') {
    const m = new PointsMaterial({ size: 1, sizeAttenuation: false });
    if (color) m.color = color;
    if (spec.vertexColors) m.vertexColors = true;
    if (spec.opacity !== undefined) { m.opacity = spec.opacity; m.transparent = transparent; }
    m.name = spec.name ?? '';
    return m;
  }
  if (topology === 'lines') {
    const m = new LineBasicMaterial();
    if (color) m.color = color;
    if (spec.vertexColors) m.vertexColors = true;
    if (spec.opacity !== undefined) { m.opacity = spec.opacity; m.transparent = transparent; }
    m.name = spec.name ?? '';
    return m;
  }

  const m = new MeshStandardMaterial();
  if (color) m.color = color;
  if (spec.metalness !== undefined) m.metalness = spec.metalness;
  if (spec.roughness !== undefined) m.roughness = spec.roughness;
  if (spec.vertexColors) m.vertexColors = true;
  if (spec.flatShading) m.flatShading = true;
  if (spec.doubleSided) m.side = DoubleSide;
  if (spec.opacity !== undefined) { m.opacity = spec.opacity; m.transparent = transparent; }
  m.name = spec.name ?? '';
  return m;
}

function buildGeometry(mesh: MeshPayload): BufferGeometry {
  if (mesh.positions.length % 3 !== 0) {
    throw new Error(
      `mesh "${mesh.name}": positions length ${mesh.positions.length} is not a multiple of 3`,
    );
  }
  const g = new BufferGeometry();
  g.name = mesh.name;
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  if (mesh.normals) g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  if (mesh.uvs) g.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
  if (mesh.colors) g.setAttribute('color', new BufferAttribute(mesh.colors, 3));
  if (mesh.indices) g.setIndex(new BufferAttribute(mesh.indices, 1));
  if (mesh.groups) {
    for (const grp of mesh.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  }
  // Triangle meshes need normals to shade at all; a plugin that omits them is asking for
  // the derived ones rather than for flat black.
  if (mesh.topology === 'triangles' && !mesh.normals) g.computeVertexNormals();
  return g;
}

/**
 * Turn a payload into a three scene graph.
 *
 * Pure and synchronous, so it runs identically on the main thread and under Node in tests.
 * The caller owns disposal of the result — see dispose.ts.
 */
export function buildScene(payload: ScenePayload): Object3D {
  if (payload.nodes.length === 0) return new Group();

  const specs = payload.materials.length ? payload.materials : [DEFAULT_MATERIAL];
  // Materials are cached per (index, topology): one Mesh material instance shared across
  // every mesh that uses it, so a 5,000-part assembly does not compile 5,000 identical
  // shader programs.
  const materialCache = new Map<string, Material>();
  const materialFor = (index: number, topology: Topology): Material => {
    const safeIndex = index >= 0 && index < specs.length ? index : 0;
    const key = `${safeIndex}:${topology}`;
    let m = materialCache.get(key);
    if (!m) {
      m = buildMaterial(specs[safeIndex] ?? DEFAULT_MATERIAL, topology);
      materialCache.set(key, m);
    }
    return m;
  };

  const buildRenderable = (mesh: MeshPayload): Object3D => {
    const geometry = buildGeometry(mesh);
    if (mesh.topology === 'points') return new Points(geometry, materialFor(mesh.materialIndex ?? 0, 'points'));
    if (mesh.topology === 'lines') return new LineSegments(geometry, materialFor(mesh.materialIndex ?? 0, 'lines'));

    // A grouped geometry needs a material array indexed the same way as its groups.
    if (mesh.groups?.length) {
      const highest = Math.max(...mesh.groups.map((g) => g.materialIndex));
      const list: Material[] = [];
      for (let i = 0; i <= highest; i++) list.push(materialFor(i, 'triangles'));
      return new Mesh(geometry, list);
    }
    return new Mesh(geometry, materialFor(mesh.materialIndex ?? 0, 'triangles'));
  };

  const objects = payload.nodes.map((node) => {
    const group = new Group();
    group.name = node.name;
    if (node.matrix) {
      group.matrixAutoUpdate = false;
      group.matrix.fromArray(Array.from(node.matrix));
      group.matrix.decompose(group.position, group.quaternion, group.scale);
      group.matrixAutoUpdate = true;
    }
    for (const mi of node.meshes) {
      const mesh = payload.meshes[mi];
      if (mesh) group.add(buildRenderable(mesh));
    }
    return group;
  });

  payload.nodes.forEach((node, i) => {
    if (node.parent >= 0 && node.parent < objects.length && node.parent !== i) {
      objects[node.parent]!.add(objects[i]!);
    }
  });

  return objects[0]!;
}

/** Identity matrix in the payload's column-major layout. */
export function identityMat4(): Mat4Array {
  return new Float64Array(new Matrix4().elements);
}
