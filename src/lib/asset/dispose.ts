/**
 * Releasing a model's GPU resources.
 *
 * Without this, repeated loads leak until the tab dies, and "the app gets slower the more
 * models I open" is a bug that takes days to find.
 *
 * Called imperatively from the load path, never inside a setState updater: revoking an
 * object URL is idempotent, but geometry.dispose() is not, and React may invoke an updater
 * twice under StrictMode.
 */
import type { BufferGeometry, Material, Object3D, Texture } from 'three';

export interface DisposeCounts {
  geometries: number;
  materials: number;
  textures: number;
}

function disposeMaterial(material: Material, counts: DisposeCounts, seen: Set<object>): void {
  if (seen.has(material)) return;
  seen.add(material);

  // Walk every own property: a material's texture slots vary by type (map, normalMap,
  // roughnessMap, envMap, alphaMap, ...) and hard-coding the list would silently miss any
  // that a loader sets.
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    const tex = value as Texture | null;
    if (tex && typeof tex === 'object' && (tex as { isTexture?: boolean }).isTexture) {
      if (seen.has(tex)) continue;
      seen.add(tex);
      tex.dispose();
      counts.textures++;
    }
  }
  material.dispose();
  counts.materials++;
}

/** Dispose every geometry, material and texture reachable from `root`. Safe to call twice. */
export function disposeObject(root: Object3D | null | undefined): DisposeCounts {
  const counts: DisposeCounts = { geometries: 0, materials: 0, textures: 0 };
  if (!root) return counts;
  const seen = new Set<object>();

  root.traverse((o) => {
    const node = o as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    if (node.geometry && !seen.has(node.geometry)) {
      seen.add(node.geometry);
      node.geometry.dispose();
      counts.geometries++;
    }
    if (node.material) {
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of list) disposeMaterial(m, counts, seen);
    }
  });

  root.removeFromParent();
  return counts;
}
