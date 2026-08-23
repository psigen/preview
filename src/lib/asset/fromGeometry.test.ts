import { describe, expect, it } from 'vitest';
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from 'three';
import { countsFor, meshPayloadFromGeometry } from './fromGeometry';
import type { MeshPayload } from './payload';

const tri = () => new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

describe('meshPayloadFromGeometry', () => {
  it('reuses a Float32Array attribute rather than copying it', () => {
    // The zero-copy path: the whole point of the payload is transferring, not duplicating.
    const positions = tri();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    expect(meshPayloadFromGeometry(g, 'm').positions).toBe(positions);
  });

  /**
   * Neither STL nor PLY produces interleaved attributes, so this branch is unreachable
   * today — but GLTFLoader builds an InterleavedBufferAttribute for any interleaved
   * accessor, which is common in optimised glTF. Covering it now means the glTF stage does
   * not discover it by rendering garbage.
   */
  it('packs an interleaved attribute into a plain array', () => {
    // Two vertices of [x,y,z,u,v] interleaved in one buffer.
    const data = new Float32Array([1, 2, 3, 0.5, 0.6, 4, 5, 6, 0.7, 0.8]);
    const buffer = new InterleavedBuffer(data, 5);
    const g = new BufferGeometry();
    g.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0));
    g.setAttribute('uv', new InterleavedBufferAttribute(buffer, 2, 3));

    const payload = meshPayloadFromGeometry(g, 'interleaved');
    expect(Array.from(payload.positions)).toEqual([1, 2, 3, 4, 5, 6]);
    // toBeCloseTo, not toEqual: 0.6 has no exact Float32 representation.
    for (const [i, want] of [0.5, 0.6, 0.7, 0.8].entries()) {
      expect(payload.uvs![i]).toBeCloseTo(want, 6);
    }
    // and it must be a standalone array, not a view over the shared interleaved buffer
    expect(payload.positions.buffer).not.toBe(data.buffer);
    expect(payload.positions.length).toBe(6);
  });

  it('widens a 16-bit index to Uint32', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(tri(), 3));
    g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    const payload = meshPayloadFromGeometry(g, 'm');
    expect(payload.indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(payload.indices!)).toEqual([0, 1, 2]);
  });

  it('drops an attribute whose itemSize is wrong rather than misreading it', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(tri(), 3));
    // A 2-component "normal" is malformed; reading it as 3 would silently shear the mesh.
    g.setAttribute('normal', new Float32BufferAttribute(new Float32Array([0, 1, 0, 1, 0, 1]), 2));
    expect(meshPayloadFromGeometry(g, 'm').normals).toBeUndefined();
  });

  it('throws when there is no position attribute at all', () => {
    expect(() => meshPayloadFromGeometry(new BufferGeometry(), 'empty')).toThrow(/position/);
  });
});

describe('countsFor', () => {
  const mesh = (over: Partial<MeshPayload> = {}): MeshPayload => ({
    name: 'm',
    positions: new Float32Array(36 * 3),
    topology: 'triangles',
    ...over,
  });

  it('counts a non-indexed mesh from its positions', () => {
    expect(countsFor([mesh()])).toEqual({ meshes: 1, triangles: 12, vertices: 36, points: 0 });
  });

  it('counts an indexed mesh from its index', () => {
    const indices = new Uint32Array(18);
    expect(countsFor([mesh({ indices })]).triangles).toBe(6);
  });

  it('counts points separately and contributes no triangles', () => {
    const c = countsFor([mesh({ topology: 'points', positions: new Float32Array(24) })]);
    expect(c).toEqual({ meshes: 0, triangles: 0, vertices: 0, points: 8 });
  });

  it('ignores lines for every count', () => {
    expect(countsFor([mesh({ topology: 'lines' })])).toEqual({
      meshes: 0, triangles: 0, vertices: 0, points: 0,
    });
  });

  it('sums across several meshes', () => {
    expect(countsFor([mesh(), mesh()]).triangles).toBe(24);
  });
});
