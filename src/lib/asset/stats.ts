/**
 * Counting a loaded model, in WORLD space.
 *
 * World-space is an invariant, not a convention: three's USDLoader bakes metersPerUnit into
 * the root's scale, so geometry.boundingBox still holds the file's native numbers. Anything
 * reading local-space geometry would silently report centimetres for a metre-scale model.
 */
import type { Object3D, BufferGeometry, Material } from 'three';
import { computeBounds } from '../bounds';
import type { AssetStats } from './types';

interface CountInput {
  readonly bytes: number;
  readonly parseMs: number;
  readonly animations: number;
}

function isMaterialArray(m: Material | Material[]): m is Material[] {
  return Array.isArray(m);
}

/** Every texture-valued property on a material, so the count matches what dispose() frees. */
function countTextures(material: Material, into: Set<object>): void {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) {
      into.add(value as object);
    }
  }
}

export function computeStats(root: Object3D, input: CountInput): AssetStats {
  let meshes = 0;
  let triangles = 0;
  let vertices = 0;
  let points = 0;
  let hasNormals = false;
  let hasUVs = false;
  let hasVertexColors = false;
  const materials = new Set<object>();
  const textures = new Set<object>();

  root.traverse((o) => {
    const node = o as Object3D & {
      isMesh?: boolean;
      isPoints?: boolean;
      isLineSegments?: boolean;
      isInstancedMesh?: boolean;
      count?: number;
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    const geometry = node.geometry;
    if (!geometry?.attributes?.position) return;

    if (node.material) {
      const list = isMaterialArray(node.material) ? node.material : [node.material];
      for (const m of list) {
        materials.add(m);
        countTextures(m, textures);
      }
    }

    const positionCount = geometry.attributes.position.count;

    if (node.isPoints) {
      points += positionCount;
      return;
    }
    if (node.isLineSegments) return; // lines contribute neither triangles nor mesh count

    if (!node.isMesh) return;
    meshes++;
    vertices += positionCount;
    // Triangle count: from the index when present, else from raw positions. Deliberately NOT
    // multiplied by geometry.groups.length — groups partition ONE index buffer, they do not
    // repeat it. Instancing genuinely does repeat, so that factor does apply.
    const perInstance = geometry.index ? geometry.index.count / 3 : positionCount / 3;
    const instances = node.isInstancedMesh ? (node.count ?? 1) : 1;
    triangles += perInstance * instances;

    if (geometry.attributes.normal) hasNormals = true;
    if (geometry.attributes.uv) hasUVs = true;
    if (geometry.attributes.color) hasVertexColors = true;
  });

  const bounds = computeBounds(root);

  return {
    meshes,
    triangles,
    vertices,
    points,
    materials: materials.size,
    textures: textures.size,
    animations: input.animations,
    hasNormals,
    hasUVs,
    hasVertexColors,
    bounds: { min: bounds.min, max: bounds.max },
    size: bounds.size,
    valid: bounds.valid,
    bytes: input.bytes,
    parseMs: input.parseMs,
  };
}
