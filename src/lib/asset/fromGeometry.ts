/**
 * The inverse of buildScene: a three BufferGeometry flattened into a transferable payload.
 *
 * Geometry-kind plugins reach for three's loaders (STLLoader, PLYLoader) because reusing a
 * battle-tested parser is far better than writing another one — three works fine in a
 * worker, it is only the DOM that does not. But the value that crosses back must be plain
 * typed arrays, so this is where the three object is left behind.
 *
 * Arrays are reused, never copied, whenever they are already the right type: the whole
 * point of the payload is a zero-copy transfer out of the worker.
 */
import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three';
import type { MeshPayload, Topology } from './payload';
import type { TranscodeCounts } from '../registry/types';

type AnyAttribute = BufferAttribute | InterleavedBufferAttribute;

function asFloat32(attribute: AnyAttribute | undefined, itemSize: number): Float32Array | undefined {
  if (!attribute) return undefined;
  if (attribute.itemSize !== itemSize) return undefined;

  // The fast path is only safe for a plain, un-normalised BufferAttribute whose storage is
  // already Float32. An InterleavedBufferAttribute's `.array` getter returns the WHOLE
  // shared buffer — every other attribute's values included — so taking it verbatim would
  // hand back sheared geometry that renders as garbage rather than failing. glTF produces
  // interleaved accessors routinely, so this is not a theoretical case.
  const interleaved = (attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute === true;
  if (!interleaved && !attribute.normalized) {
    const array = (attribute as BufferAttribute).array;
    if (array instanceof Float32Array) return array;
  }

  // Otherwise materialise a plain packed copy, going through the accessors so that
  // interleaving, normalisation and integer storage are all handled by three.
  const out = new Float32Array(attribute.count * itemSize);
  for (let i = 0; i < attribute.count; i++) {
    out[i * itemSize] = attribute.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attribute.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attribute.getZ(i);
  }
  return out;
}

/** Indices are always widened to Uint32: WebGL2 supports 32-bit universally, so carrying
 *  two index types through the pipeline buys nothing and invites an overflow bug. */
function asUint32(geometry: BufferGeometry): Uint32Array | undefined {
  const index = geometry.index;
  if (!index) return undefined;
  const array = index.array;
  return array instanceof Uint32Array ? array : Uint32Array.from(array);
}

export function meshPayloadFromGeometry(
  geometry: BufferGeometry,
  name: string,
  topology: Topology = 'triangles',
): MeshPayload {
  const positions = asFloat32(geometry.attributes.position as AnyAttribute | undefined, 3);
  if (!positions) throw new Error(`${name}: geometry has no usable position attribute`);

  return {
    name,
    positions,
    normals: asFloat32(geometry.attributes.normal as AnyAttribute | undefined, 3),
    uvs: asFloat32(geometry.attributes.uv as AnyAttribute | undefined, 2),
    colors: asFloat32(geometry.attributes.color as AnyAttribute | undefined, 3),
    indices: asUint32(geometry),
    topology,
  };
}

/** Counts for a payload, matching the definitions computeStats uses over a scene graph. */
export function countsFor(meshes: readonly MeshPayload[]): TranscodeCounts {
  let triangles = 0;
  let vertices = 0;
  let points = 0;
  let meshCount = 0;
  for (const m of meshes) {
    const vertexCount = m.positions.length / 3;
    if (m.topology === 'points') {
      points += vertexCount;
      continue;
    }
    if (m.topology === 'lines') continue;
    meshCount++;
    vertices += vertexCount;
    triangles += m.indices ? m.indices.length / 3 : vertexCount / 3;
  }
  return { meshes: meshCount, triangles, vertices, points };
}
