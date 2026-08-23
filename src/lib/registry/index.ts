import { plyDescriptor } from '../formats/ply/descriptor';
import { stlDescriptor } from '../formats/stl/descriptor';
import { createRegistry } from './registry';
import type { FormatDescriptor } from './types';

/**
 * THE registry. Adding a format is one line here plus a formats/<id>/ directory.
 *
 * Descriptors are imported eagerly and are deliberately tiny; every parser and every wasm
 * module sits behind the descriptor's dynamic `pipeline()` import.
 */
/**
 * Matches the gate in scripts/copy-wasm.mjs. STEP, IGES and BREP are the only formats behind
 * it, because occt-import-js is the only LGPL dependency; with the flag off, neither the
 * descriptors nor the 7.7 MB of vendored wasm are part of the build.
 */
const cadEnabled = import.meta.env.VITE_ENABLE_CAD !== '0';

const CAD_DESCRIPTORS: FormatDescriptor[] = [
  // step, iges and brep land here with the occt pipeline.
];

export const registry = createRegistry([
  stlDescriptor,
  plyDescriptor,
  ...(cadEnabled ? CAD_DESCRIPTORS : []),
]);
