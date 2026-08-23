import { plyDescriptor } from '../formats/ply/descriptor';
import { stlDescriptor } from '../formats/stl/descriptor';
import { createRegistry } from './registry';

/**
 * THE registry. Adding a format is one line here plus a formats/<id>/ directory.
 *
 * Descriptors are imported eagerly and are deliberately tiny; every parser and every wasm
 * module sits behind the descriptor's dynamic `pipeline()` import.
 */
export const registry = createRegistry([stlDescriptor, plyDescriptor]);
