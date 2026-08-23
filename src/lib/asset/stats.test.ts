import { describe, expect, it } from 'vitest';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Points,
  Texture,
} from 'three';
import { computeStats } from './stats';

const META = { bytes: 0, parseMs: 0, animations: 0, sourceSize: [0, 0, 0] as const };

function geom(
  triangles: number,
  opts: { indexed?: boolean; groups?: number } = {},
): BufferGeometry {
  const verts = triangles * 3;
  const g = new BufferGeometry();
  const positions = new Float32Array(verts * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = (i % 7) - 3;
  g.setAttribute('position', new BufferAttribute(positions, 3));
  if (opts.indexed)
    g.setIndex(
      new BufferAttribute(
        new Uint32Array(verts).map((_, i) => i),
        1,
      ),
    );
  if (opts.groups) {
    const per = verts / opts.groups;
    for (let i = 0; i < opts.groups; i++) g.addGroup(i * per, per, i);
  }
  return g;
}

describe('triangle counting', () => {
  it('counts a non-indexed mesh from its positions', () => {
    const root = new Group();
    root.add(new Mesh(geom(12), new MeshStandardMaterial()));
    expect(computeStats(root, META).triangles).toBe(12);
  });

  it('counts an indexed mesh from its index', () => {
    const root = new Group();
    root.add(new Mesh(geom(12, { indexed: true }), new MeshStandardMaterial()));
    expect(computeStats(root, META).triangles).toBe(12);
  });

  /**
   * The classic off-by-N. Groups PARTITION one index buffer, they do not repeat it, so a
   * geometry split into 4 material groups still has 12 triangles, not 48.
   */
  it('does not multiply by the number of material groups', () => {
    const root = new Group();
    root.add(new Mesh(geom(12, { indexed: true, groups: 4 }), new MeshStandardMaterial()));
    const stats = computeStats(root, META);
    expect(stats.triangles).toBe(12);
  });

  /** Instancing genuinely does repeat the geometry, so that factor DOES apply. */
  it('multiplies by the instance count for an InstancedMesh', () => {
    const root = new Group();
    root.add(new InstancedMesh(geom(2), new MeshStandardMaterial(), 50));
    expect(computeStats(root, META).triangles).toBe(100);
  });

  it('sums across a hierarchy', () => {
    const root = new Group();
    const child = new Group();
    child.add(new Mesh(geom(3), new MeshStandardMaterial()));
    root.add(new Mesh(geom(12), new MeshStandardMaterial()), child);
    expect(computeStats(root, META).triangles).toBe(15);
    expect(computeStats(root, META).meshes).toBe(2);
  });
});

describe('primitive kinds', () => {
  it('counts Points separately and contributes no triangles', () => {
    const root = new Group();
    root.add(new Points(geom(4), new MeshStandardMaterial()));
    const s = computeStats(root, META);
    expect(s.points).toBe(12);
    expect(s.triangles).toBe(0);
    expect(s.meshes).toBe(0);
  });

  it('ignores LineSegments for both counts', () => {
    const root = new Group();
    root.add(new LineSegments(geom(4), new MeshStandardMaterial()));
    const s = computeStats(root, META);
    expect(s.triangles).toBe(0);
    expect(s.points).toBe(0);
  });
});

describe('attribute and resource reporting', () => {
  it('reports which vertex attributes are present', () => {
    const g = geom(1);
    const root = new Group();
    root.add(new Mesh(g, new MeshStandardMaterial()));
    let s = computeStats(root, META);
    expect(s.hasNormals).toBe(false);
    expect(s.hasUVs).toBe(false);
    expect(s.hasVertexColors).toBe(false);

    g.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(6), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(9), 3));
    s = computeStats(root, META);
    expect(s.hasNormals).toBe(true);
    expect(s.hasUVs).toBe(true);
    expect(s.hasVertexColors).toBe(true);
  });

  it('counts a shared material once', () => {
    const shared = new MeshStandardMaterial();
    const root = new Group();
    root.add(new Mesh(geom(1), shared), new Mesh(geom(1), shared));
    expect(computeStats(root, META).materials).toBe(1);
  });

  it('counts textures across every material slot', () => {
    const m = new MeshStandardMaterial();
    m.map = new Texture();
    m.normalMap = new Texture();
    const root = new Group();
    root.add(new Mesh(geom(1), m));
    expect(computeStats(root, META).textures).toBe(2);
  });

  it('passes through byte size, parse time and animation count', () => {
    const root = new Group();
    root.add(new Mesh(geom(1), new MeshStandardMaterial()));
    const s = computeStats(root, { ...META, bytes: 4096, parseMs: 17, animations: 3 });
    expect(s.bytes).toBe(4096);
    expect(s.parseMs).toBe(17);
    expect(s.animations).toBe(3);
  });
});

describe('world-space bounds', () => {
  /**
   * The reason bounds must come from world space: three's USDLoader bakes metersPerUnit into
   * the root scale, leaving geometry.boundingBox holding the file's native numbers. Reading
   * local space would report the wrong size for every USD model.
   */
  it('reflects an ancestor scale rather than the local geometry', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 10, 20, 30]), 3));
    const root = new Group();
    root.scale.setScalar(0.001);
    root.add(new Mesh(g, new MeshStandardMaterial()));
    const s = computeStats(root, META);
    expect(s.size[0]).toBeCloseTo(0.01, 9);
    expect(s.size[1]).toBeCloseTo(0.02, 9);
    expect(s.size[2]).toBeCloseTo(0.03, 9);
  });

  it('marks a model with no geometry invalid', () => {
    const s = computeStats(new Group(), META);
    expect(s.valid).toBe(false);
    expect(s.meshes).toBe(0);
  });
});
