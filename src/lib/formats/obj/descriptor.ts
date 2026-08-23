import type { FormatDescriptor } from '../../registry/types';

export const objDescriptor: FormatDescriptor = {
  id: 'obj',
  capabilities: {
    // Wavefront OBJ records neither a unit nor an orientation.
    declaresUnits: false,
    declaresUpAxis: false,
    // Materials live in a companion .mtl rather than in the file itself.
    materials: true,
    textures: true,
    animations: false,
    usesCompanions: true,
    license: 'MIT',
  },
  pipeline: () => import('./pipeline').then((m) => m.objPipeline),
};
