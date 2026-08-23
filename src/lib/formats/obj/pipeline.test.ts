import { describe, expect, it } from 'vitest';
import type { Mesh, MeshPhongMaterial } from 'three';
import { extentsIn } from '../../../../test/gen/box';
import { objMtl } from '../../../../test/gen/writers';
import { DEFAULT_QUALITY, type AssetFile, type LoadContext, type LoadInput } from '../../registry/types';
import { objPipeline } from './pipeline';

const mm = extentsIn('millimeter');

const ctx = (): LoadContext => ({
  onProgress: () => {},
  warn: () => {},
  signal: new AbortController().signal,
  quality: DEFAULT_QUALITY,
});

const file = (path: string, bytes: ArrayBuffer): AssetFile => ({ name: path, path, bytes });

function input(objBytes: ArrayBuffer, companions: [string, ArrayBuffer][] = []): LoadInput {
  return {
    primary: file('box.obj', objBytes),
    companions: new Map(companions.map(([p, b]) => [p, file(p, b)])),
  };
}

function firstMaterial(object: { traverse(cb: (o: unknown) => void): void }): MeshPhongMaterial | null {
  let found: MeshPhongMaterial | null = null;
  object.traverse((o) => {
    const mesh = o as Mesh & { isMesh?: boolean };
    if (mesh.isMesh && !found) found = mesh.material as MeshPhongMaterial;
  });
  return found;
}

describe('objPipeline', () => {
  it('loads geometry with no companions at all', async () => {
    const { obj } = objMtl(mm);
    const asset = await objPipeline.load(input(obj), ctx());
    let triangles = 0;
    asset.object.traverse((o) => {
      const mesh = o as Mesh & { isMesh?: boolean };
      if (mesh.isMesh) {
        const g = mesh.geometry;
        triangles += g.index ? g.index.count / 3 : g.attributes.position!.count / 3;
      }
    });
    expect(triangles).toBe(12);
  });

  it('warns, but still loads, when the referenced .mtl is missing', async () => {
    const { obj } = objMtl(mm);
    const asset = await objPipeline.load(input(obj), ctx());
    const w = asset.warnings?.find((x) => x.code === 'missing-companion');
    expect(w?.message).toContain('box.mtl');
    // Actionable, not just a complaint.
    expect(w?.message).toMatch(/drop the folder/i);
  });

  /**
   * The distinctive thing about OBJ. MTLLoader normally reaches for TextureLoader, which
   * needs a document — but it checks manager.getHandler() first, so an untextured material
   * resolves fully even under Node. Kd 0.80 0.35 0.20 must survive to the material.
   */
  it('applies the companion .mtl, including its diffuse colour', async () => {
    const { obj, mtl, mtlName } = objMtl(mm);
    const asset = await objPipeline.load(input(obj, [[mtlName, mtl]]), ctx());
    expect(asset.warnings?.some((w) => w.code === 'missing-companion')).toBe(false);

    const material = firstMaterial(asset.object);
    expect(material).not.toBeNull();
    expect(material!.color.getHexString()).toBe('cc5933');
  });

  it('finds the .mtl by bare filename when the drop was a folder', async () => {
    const { obj, mtl } = objMtl(mm);
    // A folder drop keys companions by relative path, but the OBJ names only the file.
    const asset = await objPipeline.load(input(obj, [['textures/box.mtl', mtl]]), ctx());
    expect(asset.warnings?.some((w) => w.code === 'missing-companion')).toBe(false);
    expect(firstMaterial(asset.object)!.color.getHexString()).toBe('cc5933');
  });

  it('declares no units and no up axis, rather than guessing', async () => {
    const asset = await objPipeline.load(input(objMtl(mm).obj), ctx());
    expect(asset.units.known).toBe(false);
    expect(asset.sourceUpAxis).toBe('unknown');
    expect(asset.orientation).toBe('file');
  });

  it('has nothing to revoke when no companion supplied a texture', async () => {
    const asset = await objPipeline.load(input(objMtl(mm).obj), ctx());
    expect(() => asset.dispose?.()).not.toThrow();
  });
});
