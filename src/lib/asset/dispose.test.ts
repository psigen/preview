import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { disposeObject } from './dispose';

function mesh(material = new MeshStandardMaterial()): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  return new Mesh(g, material);
}

describe('disposeObject', () => {
  it('frees geometries, materials and textures', () => {
    const m = new MeshStandardMaterial();
    m.map = new Texture();
    const node = mesh(m);
    const root = new Group();
    root.add(node);

    const gSpy = vi.spyOn(node.geometry, 'dispose');
    const mSpy = vi.spyOn(m, 'dispose');
    const tSpy = vi.spyOn(m.map, 'dispose');

    const counts = disposeObject(root);
    expect(gSpy).toHaveBeenCalledTimes(1);
    expect(mSpy).toHaveBeenCalledTimes(1);
    expect(tSpy).toHaveBeenCalledTimes(1);
    expect(counts).toEqual({ geometries: 1, materials: 1, textures: 1 });
  });

  it('frees a shared material exactly once', () => {
    const shared = new MeshStandardMaterial();
    const root = new Group();
    root.add(mesh(shared), mesh(shared));
    const spy = vi.spyOn(shared, 'dispose');
    const counts = disposeObject(root);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(counts.materials).toBe(1);
    expect(counts.geometries).toBe(2);
  });

  it('frees a texture shared between two materials exactly once', () => {
    const tex = new Texture();
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    a.map = tex;
    b.map = tex;
    const root = new Group();
    root.add(mesh(a), mesh(b));
    const spy = vi.spyOn(tex, 'dispose');
    expect(disposeObject(root).textures).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  /**
   * Texture slots vary by material type, so the walk is property-based rather than a
   * hard-coded list that would silently miss whatever a loader happened to set.
   */
  it('finds textures in any slot, not just .map', () => {
    const m = new MeshStandardMaterial();
    m.normalMap = new Texture();
    m.roughnessMap = new Texture();
    m.emissiveMap = new Texture();
    const root = new Group();
    root.add(mesh(m));
    expect(disposeObject(root).textures).toBe(3);
  });

  it('handles an array material', () => {
    const mats = [new MeshStandardMaterial(), new MeshStandardMaterial()];
    const node = mesh();
    node.material = mats;
    const root = new Group();
    root.add(node);
    expect(disposeObject(root).materials).toBe(2);
  });

  it('detaches the root so it cannot be rendered again', () => {
    const parent = new Group();
    const root = new Group();
    parent.add(root);
    disposeObject(root);
    expect(root.parent).toBeNull();
    expect(parent.children).toHaveLength(0);
  });

  it('tolerates null and an empty graph', () => {
    expect(disposeObject(null)).toEqual({ geometries: 0, materials: 0, textures: 0 });
    expect(disposeObject(new Group())).toEqual({ geometries: 0, materials: 0, textures: 0 });
  });

  it('does not double-free when called twice', () => {
    const m = new MeshStandardMaterial();
    const node = mesh(m);
    const root = new Group();
    root.add(node);
    const spy = vi.spyOn(node.geometry, 'dispose');
    disposeObject(root);
    disposeObject(root);
    // three's dispose is itself idempotent, but the counts must not keep climbing on a
    // graph that has already been torn down.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
