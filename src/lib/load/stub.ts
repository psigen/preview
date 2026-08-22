/**
 * A stub loader producing the canonical box.
 *
 * Exists so the viewer can be built and exercised against the real contract before any
 * format plugin lands. It goes through the production path — ScenePayload -> buildScene ->
 * finalize — rather than hand-assembling an Object3D, so it also serves as a worked example
 * of what a geometry-kind plugin must return.
 */
import { buildScene, type MeshPayload, type ScenePayload } from '../asset/payload';
import { UNITS_DECLARED, UNITS_UNKNOWN, type RawAsset, type UpAxis } from '../asset/types';
import { finalize } from './finalize';
import type { LoadedModel } from '../asset/types';

/** 10 x 20 x 30 mm, one corner at the origin — the same shape the test fixtures use. */
const EXTENTS: [number, number, number] = [10, 20, 30];

const CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

const TRIS: readonly (readonly [number, number, number])[] = [
  [0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
  [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
];

const NORMALS: readonly (readonly [number, number, number])[] = [
  [0, 0, -1], [0, 0, -1], [0, 0, 1], [0, 0, 1],
  [0, -1, 0], [0, -1, 0], [0, 1, 0], [0, 1, 0],
  [-1, 0, 0], [-1, 0, 0], [1, 0, 0], [1, 0, 0],
];

export interface StubOptions {
  /** Extents in the model's own units. Defaults to 10 x 20 x 30. */
  readonly extents?: readonly [number, number, number];
  /** null produces an abstract-units model, as STL would. */
  readonly metersPerUnit?: number | null;
  readonly sourceUpAxis?: UpAxis;
}

/** A non-indexed triangle soup, exactly as a transcode plugin would emit. */
export function stubPayload(extents: readonly [number, number, number] = EXTENTS): ScenePayload {
  const positions = new Float32Array(36 * 3);
  const normals = new Float32Array(36 * 3);
  let o = 0;
  TRIS.forEach((tri, t) => {
    for (const ci of tri) {
      const c = CORNERS[ci]!;
      positions[o] = c[0] * extents[0];
      positions[o + 1] = c[1] * extents[1];
      positions[o + 2] = c[2] * extents[2];
      normals.set(NORMALS[t]!, o);
      o += 3;
    }
  });

  const mesh: MeshPayload = { name: 'box', positions, normals, topology: 'triangles' };
  return {
    nodes: [{ name: 'root', parent: -1, meshes: [0] }],
    meshes: [mesh],
    materials: [],
  };
}

export function stubRawAsset(options: StubOptions = {}): RawAsset {
  const { extents = EXTENTS, metersPerUnit = 0.001, sourceUpAxis = 'Y' } = options;
  return {
    object: buildScene(stubPayload(extents)),
    units:
      metersPerUnit === null
        ? UNITS_UNKNOWN('This is a placeholder model with no declared units.')
        : UNITS_DECLARED(metersPerUnit, 'mm'),
    sourceUpAxis,
    orientation: 'file',
  };
}

let nextId = 1;

/** A ready-to-render LoadedModel, for developing the viewer before plugins exist. */
export function loadStubModel(options: StubOptions = {}): LoadedModel {
  const started = performance.now();
  const raw = stubRawAsset(options);
  return finalize(raw, {
    id: nextId++,
    name: 'stub-box',
    format: 'stl',
    bytes: 0,
    parseMs: performance.now() - started,
  });
}
