/**
 * Priming the CAD engine for the Node test tier.
 *
 * The browser fetches the wasm from public/vendor; Node reads it straight out of
 * node_modules. Because loadOcct is a singleton, priming it once here makes every later bare
 * call resolve from cache, so the pipeline under test needs no special casing.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadOcct } from '../src/lib/decoders/occtWasm';

const require_ = createRequire(import.meta.url);

let primed: Promise<void> | null = null;

export function primeOcct(): Promise<void> {
  if (!primed) {
    primed = (async () => {
      const path = require_.resolve('occt-import-js/dist/occt-import-js.wasm');
      const bytes = await readFile(path);
      await loadOcct(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    })();
  }
  return primed;
}
