import type { Material, Texture } from 'three';

/**
 * Every texture-valued property on a material.
 *
 * Property-based rather than a hard-coded slot list: which maps exist varies by material
 * type (map, normalMap, roughnessMap, envMap, alphaMap, aoMap, ...), and enumerating them
 * would silently miss whatever a loader happened to set.
 *
 * Shared so that counting textures and freeing them can never disagree — if stats reports a
 * texture that dispose does not release, that is a leak nobody would notice.
 */
export function texturesOf(material: Material): Texture[] {
  const found: Texture[] = [];
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) {
      found.push(value as Texture);
    }
  }
  return found;
}
