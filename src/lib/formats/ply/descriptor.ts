import type { FormatDescriptor } from '../../registry/types';

export const plyDescriptor: FormatDescriptor = {
  id: 'ply',
  capabilities: {
    declaresUnits: false,
    declaresUpAxis: false,
    // Per-vertex colours only; PLY has no material model.
    materials: false,
    textures: false,
    animations: false,
    usesCompanions: false,
    license: 'MIT',
  },
  pipeline: () => import('./pipeline').then((m) => m.plyPipeline),
};
