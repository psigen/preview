import type { FormatDescriptor } from '../../registry/types';

export const gltfDescriptor: FormatDescriptor = {
  id: 'gltf',
  capabilities: {
    // The spec mandates metres, so a glTF always has real units even though no field
    // states them.
    declaresUnits: true,
    // And it is always Y-up, by the same clause.
    declaresUpAxis: true,
    materials: true,
    textures: true,
    animations: true,
    usesCompanions: true,
    license: 'MIT',
  },
  pipeline: () => import('./pipeline').then((m) => m.gltfPipeline),
};
