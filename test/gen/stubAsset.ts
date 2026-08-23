/**
 * A configurable RawAsset for testing the finaliser in isolation.
 *
 * Lives in test/ rather than src/ because the app now loads real sample bytes through the
 * ordinary pipeline; this exists only so finalize's units and orientation handling can be
 * exercised without dragging a parser in.
 */
import { buildScene, type MeshPayload, type ScenePayload } from '../../src/lib/asset/payload';
import {
  UNITS_DECLARED,
  UNITS_UNKNOWN,
  type RawAsset,
  type UpAxis,
} from '../../src/lib/asset/types';
import { corners, FACE_NORMALS, TRIS, type Extents } from '../../src/lib/samples/box';

const DEFAULT_EXTENTS: [number, number, number] = [10, 20, 30];

export interface StubOptions {
  readonly extents?: readonly [number, number, number];
  /** null produces an abstract-units model, as STL does. */
  readonly metersPerUnit?: number | null;
  readonly sourceUpAxis?: UpAxis;
}

/** A non-indexed triangle soup, exactly as a transcode plugin emits. */
export function stubPayload(
  extents: readonly [number, number, number] = DEFAULT_EXTENTS,
): ScenePayload {
  const ext: Extents = { x: extents[0], y: extents[1], z: extents[2] };
  const c = corners(ext);
  const positions = new Float32Array(36 * 3);
  const normals = new Float32Array(36 * 3);
  let o = 0;
  TRIS.forEach((tri, t) => {
    for (const ci of tri) {
      positions.set(c[ci]!, o);
      normals.set(FACE_NORMALS[t]!, o);
      o += 3;
    }
  });
  const mesh: MeshPayload = { name: 'box', positions, normals, topology: 'triangles' };
  return { nodes: [{ name: 'root', parent: -1, meshes: [0] }], meshes: [mesh], materials: [] };
}

export function stubRawAsset(options: StubOptions = {}): RawAsset {
  const { extents = DEFAULT_EXTENTS, metersPerUnit = 0.001, sourceUpAxis = 'Y' } = options;
  return {
    object: buildScene(stubPayload(extents)),
    units:
      metersPerUnit === null
        ? UNITS_UNKNOWN('This placeholder declares no units.')
        : UNITS_DECLARED(metersPerUnit, 'mm'),
    sourceUpAxis,
    orientation: 'file',
  };
}
