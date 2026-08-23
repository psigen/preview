import { describe, expect, it } from 'vitest';
import type { OcctResult } from 'occt-import-js';
import { OcctConversionError, convertOcctResult } from './convert';

/**
 * Pure conversion tests: hand-written OCCT-shaped JSON in, ScenePayload out. No wasm, so
 * these run in milliseconds and cover the structural cases a real file would only sometimes
 * exercise.
 */
const tri = (n = 1) => ({
  position: { array: Array.from({ length: n * 9 }, (_, i) => i % 7) },
});
const mesh = (over: Partial<OcctResult['meshes'][number]> = {}) => ({
  name: 'solid',
  attributes: tri(2),
  index: { array: [0, 1, 2, 3, 4, 5] },
  ...over,
});
const ok = (over: Partial<OcctResult> = {}): OcctResult => ({
  success: true,
  meshes: [mesh()],
  ...over,
});

describe('convertOcctResult', () => {
  it('converts a single solid', () => {
    const scene = convertOcctResult(ok(), 'part.step');
    expect(scene.meshes).toHaveLength(1);
    expect(scene.meshes[0]!.positions).toBeInstanceOf(Float32Array);
    expect(scene.meshes[0]!.indices).toBeInstanceOf(Uint32Array);
    expect(scene.nodes[0]!.parent).toBe(-1);
  });

  it('carries normals through when OCCT supplied them', () => {
    const withNormals = ok({
      meshes: [mesh({ attributes: { ...tri(2), normal: { array: Array(18).fill(0) } } })],
    });
    expect(convertOcctResult(withNormals, 'p.step').meshes[0]!.normals).toBeInstanceOf(Float32Array);
  });

  it('rejects a failed read', () => {
    expect(() => convertOcctResult({ success: false, meshes: [] }, 'bad.step')).toThrow(
      OcctConversionError,
    );
  });

  /**
   * The case that matters: OCCT returns success for an IGES containing only curves, with no
   * meshes at all. Trusting the flag alone would present an empty viewport as a clean load.
   */
  it('rejects a successful read that produced no geometry', () => {
    expect(() => convertOcctResult({ success: true, meshes: [] }, 'curves.iges')).toThrow(
      /no renderable geometry/i,
    );
  });

  it('drops a degenerate face without failing the whole file', () => {
    const scene = convertOcctResult(
      ok({ meshes: [mesh(), mesh({ attributes: { position: { array: [] } }, index: { array: [] } })] }),
      'p.step',
    );
    expect(scene.meshes).toHaveLength(1);
  });

  it('flattens a node hierarchy into parent indices', () => {
    const scene = convertOcctResult(
      ok({
        meshes: [mesh(), mesh()],
        root: {
          name: 'assembly',
          meshes: [],
          children: [
            { name: 'a', meshes: [0], children: [] },
            { name: 'b', meshes: [1], children: [{ name: 'b1', meshes: [], children: [] }] },
          ],
        },
      }),
      'asm.step',
    );
    expect(scene.nodes.map((n) => n.name)).toEqual(['assembly', 'a', 'b', 'b1']);
    expect(scene.nodes.map((n) => n.parent)).toEqual([-1, 0, 0, 2]);
    expect(scene.nodes[1]!.meshes).toEqual([0]);
  });

  it('rescues a mesh that the hierarchy never references', () => {
    const scene = convertOcctResult(
      ok({
        meshes: [mesh(), mesh()],
        root: { name: 'root', meshes: [0], children: [] },
      }),
      'asm.step',
    );
    // Mesh 1 is attached to nothing; hanging it off the root beats it vanishing.
    expect(scene.nodes[0]!.meshes).toEqual([0, 1]);
  });

  /** brep_faces ranges are in TRIANGLES; a geometry group is in INDICES. */
  it('turns per-face colours into geometry groups, converting triangles to indices', () => {
    const scene = convertOcctResult(
      ok({
        meshes: [
          mesh({
            brep_faces: [
              { first: 0, last: 0, color: [1, 0, 0] },
              { first: 1, last: 1, color: [0, 1, 0] },
            ],
          }),
        ],
      }),
      'coloured.step',
    );
    const groups = scene.meshes[0]!.groups!;
    expect(groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
    ]);
    expect(scene.materials).toHaveLength(2);
  });

  it('ignores brep_faces when no face carries a colour', () => {
    const scene = convertOcctResult(
      ok({ meshes: [mesh({ brep_faces: [{ first: 0, last: 1, color: null }] })] }),
      'plain.step',
    );
    expect(scene.meshes[0]!.groups).toBeUndefined();
    expect(scene.meshes[0]!.materialIndex).toBe(0);
  });

  it('deduplicates identical colours across faces and meshes', () => {
    const red: [number, number, number] = [1, 0, 0];
    const scene = convertOcctResult(
      ok({ meshes: [mesh({ color: red }), mesh({ color: red }), mesh({ color: [0, 0, 1] })] }),
      'p.step',
    );
    expect(scene.materials).toHaveLength(2);
    expect(scene.meshes[0]!.materialIndex).toBe(scene.meshes[1]!.materialIndex);
  });

  it('makes every material double-sided, because CAD winding is unreliable', () => {
    const scene = convertOcctResult(ok(), 'p.step');
    expect(scene.materials.every((m) => m.doubleSided)).toBe(true);
  });
});
