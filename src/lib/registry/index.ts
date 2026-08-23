import { gltfDescriptor } from '../formats/gltf/descriptor';
import { igesDescriptor } from '../formats/iges/descriptor';
import { objDescriptor } from '../formats/obj/descriptor';
import { plyDescriptor } from '../formats/ply/descriptor';
import { stepDescriptor } from '../formats/step/descriptor';
import { stlDescriptor } from '../formats/stl/descriptor';
import { usdDescriptor } from '../formats/usd/descriptor';
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

// BREP is deliberately absent: it is an Open CASCADE working format that was never asked
// for, and there is no fixture, so registering it would ship an untested path. The sniffer
// still knows it, so a dropped .brep gets "recognised but not supported yet".
const CAD_DESCRIPTORS: FormatDescriptor[] = [stepDescriptor, igesDescriptor];

export const registry = createRegistry([
  usdDescriptor,
  gltfDescriptor,
  objDescriptor,
  stlDescriptor,
  plyDescriptor,
  ...(cadEnabled ? CAD_DESCRIPTORS : []),
]);
