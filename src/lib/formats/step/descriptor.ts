import type { FormatDescriptor } from '../../registry/types';

/**
 * STEP (.step / .stp), read by Open CASCADE.
 *
 * All three CAD formats share one pipeline — the reader differs only in an entry point —
 * and all three are LGPL-encumbered, which is why they are the only formats behind
 * VITE_ENABLE_CAD.
 */
export const stepDescriptor: FormatDescriptor = {
  id: 'step',
  capabilities: {
    declaresUnits: true,
    declaresUpAxis: false,
    materials: true,
    textures: false,
    animations: false,
    usesCompanions: false,
    license: 'LGPL-2.1',
  },
  pipeline: () => import('../occt/pipeline').then((m) => m.stepPipeline),
};
