/**
 * The set of formats the app can identify. Kept in its own leaf module so that
 * `lib/detect` (which identifies bytes) and `lib/registry` (which loads them) share a
 * vocabulary without depending on each other.
 */
export const FORMAT_IDS = [
  'stl',
  'ply',
  'obj',
  'gltf',
  'usd',
  '3mf',
  'fbx',
  'step',
  'iges',
  'brep',
] as const;

export type FormatId = (typeof FORMAT_IDS)[number];
