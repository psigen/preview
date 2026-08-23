import { describe, expect, it } from 'vitest';
import { BufferGeometry, DoubleSide, Matrix4, Mesh, MeshStandardMaterial, Points } from 'three';
import {
  DEFAULT_MATERIAL,
  buildScene,
  collectTransferables,
  type Mat4Array,
  type MeshPayload,
  type ScenePayload,
} from './payload';

/** Identity in the payload's column-major layout. Only tests need to build one. */
const identityMat4 = (): Mat4Array => new Float64Array(new Matrix4().elements);

const tri = (): Float32Array => new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

const onePayload = (over: Partial<MeshPayload> = {}): ScenePayload => ({
  nodes: [{ name: 'root', parent: -1, meshes: [0] }],
  meshes: [{ name: 'm', positions: tri(), topology: 'triangles', ...over }],
  materials: [],
});

describe('buildScene', () => {
  it('produces a mesh carrying the exact input arrays', () => {
    const positions = tri();
    const root = buildScene(onePayload({ positions }));
    const mesh = root.children[0] as Mesh;
    expect(mesh.isMesh).toBe(true);
    // Same buffer, not a copy — the whole point of a transferable payload.
    expect((mesh.geometry.attributes.position as { array: Float32Array }).array).toBe(positions);
  });

  it('computes normals when a triangle mesh omits them', () => {
    const mesh = buildScene(onePayload()).children[0] as Mesh;
    expect(mesh.geometry.attributes.normal).toBeDefined();
  });

  it('keeps supplied normals, uvs, colours and indices', () => {
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
    const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const indices = new Uint32Array([0, 1, 2]);
    const mesh = buildScene(onePayload({ normals, uvs, colors, indices })).children[0] as Mesh;
    const g = mesh.geometry as BufferGeometry;
    expect((g.attributes.normal as { array: Float32Array }).array).toBe(normals);
    expect((g.attributes.uv as { array: Float32Array }).array).toBe(uvs);
    expect((g.attributes.color as { array: Float32Array }).array).toBe(colors);
    expect(g.index?.array).toBe(indices);
  });

  it('rejects a positions array that is not a multiple of 3', () => {
    expect(() => buildScene(onePayload({ positions: new Float32Array(4) }))).toThrow(/multiple of 3/);
  });

  it('builds Points and LineSegments for the other topologies', () => {
    expect(buildScene(onePayload({ topology: 'points' })).children[0]).toBeInstanceOf(Points);
    const lines = buildScene(onePayload({ topology: 'lines' })).children[0];
    expect((lines as { isLineSegments?: boolean }).isLineSegments).toBe(true);
  });

  it('applies the neutral default material when none is supplied', () => {
    const mesh = buildScene(onePayload()).children[0] as Mesh;
    const m = mesh.material as MeshStandardMaterial;
    expect(m.side).toBe(DoubleSide); // CAD winding is unreliable; single-sided hides half the part
    expect(m.roughness).toBeCloseTo(DEFAULT_MATERIAL.roughness!, 6);
  });

  it('shares one material instance across meshes that use it', () => {
    // A 5,000-part assembly must not compile 5,000 identical shader programs.
    const payload: ScenePayload = {
      nodes: [{ name: 'root', parent: -1, meshes: [0, 1] }],
      meshes: [
        { name: 'a', positions: tri(), topology: 'triangles', materialIndex: 0 },
        { name: 'b', positions: tri(), topology: 'triangles', materialIndex: 0 },
      ],
      materials: [{ name: 'shared', color: [1, 0, 0] }],
    };
    const root = buildScene(payload);
    const [a, b] = root.children as Mesh[];
    expect(a!.material).toBe(b!.material);
  });

  it('gives a grouped geometry a material array indexed like its groups', () => {
    const payload: ScenePayload = {
      nodes: [{ name: 'root', parent: -1, meshes: [0] }],
      meshes: [
        {
          name: 'multi',
          positions: new Float32Array(18),
          topology: 'triangles',
          groups: [
            { start: 0, count: 3, materialIndex: 0 },
            { start: 3, count: 3, materialIndex: 1 },
          ],
        },
      ],
      materials: [{ color: [1, 0, 0] }, { color: [0, 1, 0] }],
    };
    const mesh = buildScene(payload).children[0] as Mesh;
    expect(Array.isArray(mesh.material)).toBe(true);
    expect((mesh.material as unknown[]).length).toBe(2);
    expect(mesh.geometry.groups).toHaveLength(2);
  });

  it('falls back to the first material for an out-of-range index', () => {
    const root = buildScene({
      nodes: [{ name: 'root', parent: -1, meshes: [0] }],
      meshes: [{ name: 'm', positions: tri(), topology: 'triangles', materialIndex: 99 }],
      materials: [{ color: [1, 0, 0] }],
    });
    expect(() => root.children[0]).not.toThrow();
    expect((root.children[0] as Mesh).material).toBeDefined();
  });

  it('reconstructs a node hierarchy with local transforms', () => {
    const m = identityMat4();
    m[12] = 5; // translate x, column-major
    const payload: ScenePayload = {
      nodes: [
        { name: 'root', parent: -1, meshes: [] },
        { name: 'child', parent: 0, matrix: m, meshes: [0] },
      ],
      meshes: [{ name: 'm', positions: tri(), topology: 'triangles' }],
      materials: [],
    };
    const root = buildScene(payload);
    expect(root.name).toBe('root');
    const child = root.children[0]!;
    expect(child.name).toBe('child');
    expect(child.position.x).toBeCloseTo(5, 9);
  });

  it('ignores a self-parenting node rather than looping forever', () => {
    const root = buildScene({
      nodes: [{ name: 'root', parent: 0, meshes: [] }],
      meshes: [],
      materials: [],
    });
    expect(root.children).toHaveLength(0);
  });

  it('returns an empty group for an empty payload', () => {
    const root = buildScene({ nodes: [], meshes: [], materials: [] });
    expect(root.children).toHaveLength(0);
  });
});

describe('collectTransferables', () => {
  it('lists every distinct backing buffer', () => {
    const payload = onePayload({ normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) });
    expect(collectTransferables(payload)).toHaveLength(3);
  });

  it('dedupes attributes that share one allocation', () => {
    // Passing the same ArrayBuffer twice in a transfer list throws, and plugins do sub-array
    // a single allocation across attributes.
    const shared = new ArrayBuffer(9 * 4 * 2);
    const payload = onePayload({
      positions: new Float32Array(shared, 0, 9),
      normals: new Float32Array(shared, 36, 9),
    });
    expect(collectTransferables(payload)).toEqual([shared]);
  });

  it('includes node matrices', () => {
    const payload: ScenePayload = {
      nodes: [{ name: 'root', parent: -1, matrix: identityMat4(), meshes: [] }],
      meshes: [],
      materials: [],
    };
    expect(collectTransferables(payload)).toHaveLength(1);
  });
});

describe('worker round-trip', () => {
  it('survives structuredClone, which is what postMessage does', () => {
    const payload = onePayload({ normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) });
    const cloned = structuredClone(payload) as ScenePayload;
    const before = buildScene(payload).children[0] as Mesh;
    const after = buildScene(cloned).children[0] as Mesh;
    expect(Array.from((after.geometry.attributes.position as { array: Float32Array }).array)).toEqual(
      Array.from((before.geometry.attributes.position as { array: Float32Array }).array),
    );
    expect(after.geometry.index?.count).toBe(before.geometry.index?.count);
  });
});
