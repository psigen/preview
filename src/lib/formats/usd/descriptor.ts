import type { FormatDescriptor } from '../../registry/types';

export const usdDescriptor: FormatDescriptor = {
  id: 'usd',
  capabilities: {
    // A stage declares metersPerUnit and upAxis, which is what makes USD the richest source
    // of real units the app has.
    declaresUnits: true,
    declaresUpAxis: true,
    materials: true,
    textures: true,
    animations: true,
    usesCompanions: true,
    license: 'MIT',
  },
  pipeline: () => import('./pipeline').then((m) => m.usdPipeline),
};
