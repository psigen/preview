import type { FormatDescriptor } from '../../registry/types';

/**
 * No static three import: everything heavy is behind pipeline(). A source-text test
 * enforces this across every descriptor.
 */
export const stlDescriptor: FormatDescriptor = {
  id: 'stl',
  capabilities: {
    // STL records no unit and no orientation. The ruler shows bare numbers rather than
    // inventing a scale, and the model is presented unrotated.
    declaresUnits: false,
    declaresUpAxis: false,
    materials: false,
    textures: false,
    animations: false,
    usesCompanions: false,
    license: 'MIT',
  },
  pipeline: () => import('./pipeline').then((m) => m.stlPipeline),
};
