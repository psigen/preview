import type { OcctModule } from 'occt-import-js';
import { vendorUrl } from './assetUrl';

/**
 * The Open CASCADE runtime.
 *
 * Loaded exactly once and cached, following the singleton + in-flight-dedupe +
 * reset-on-failure shape used throughout this project: the wasm is 7.6 MB, so a second
 * concurrent request must join the first rather than start another download, and a failed
 * attempt must not poison every later one.
 *
 * The bytes are fetched here and handed to the factory as `wasmBinary`. That is not a
 * convenience — emscripten decides how to load its own wasm from three environment flags,
 * all of which are false inside a module worker, so without this it simply cannot find the
 * file. Supplying the bytes short-circuits that entirely and makes the module behave
 * identically on the main thread, in a worker, and under Node.
 */
let cached: OcctModule | null = null;
let inFlight: Promise<OcctModule> | null = null;

export function isOcctLoaded(): boolean {
  return cached !== null;
}

async function fetchWasm(): Promise<ArrayBuffer> {
  const url = vendorUrl('occt/occt-import-js.wasm');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not load the CAD engine (${response.status} from ${url}). ` +
        'It is staged into public/vendor by the postinstall script.',
    );
  }
  return response.arrayBuffer();
}

/**
 * @param wasmBinary supply the bytes to skip the fetch.
 *
 * Not a test seam: the worker will be handed these over postMessage rather than fetching
 * them itself, and the Node test tier reads them from node_modules. Because the module is a
 * singleton, priming it once with explicit bytes makes every later bare `loadOcct()` resolve
 * from cache.
 */
export function loadOcct(wasmBinary?: ArrayBuffer): Promise<OcctModule> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const [{ default: occtimportjs }, bytes] = await Promise.all([
      import('occt-import-js'),
      wasmBinary ? Promise.resolve(wasmBinary) : fetchWasm(),
    ]);
    const module = await occtimportjs({
      wasmBinary: bytes,
      // OCCT writes progress chatter ("Total number of loaded entities N.") to stdout;
      // silence it so it cannot drown a real message.
      print: () => {},
      printErr: () => {},
    });
    cached = module;
    return module;
  })().catch((err) => {
    inFlight = null; // allow a retry after a failed load
    throw err;
  });

  return inFlight;
}

/** Warm the engine in the background once a CAD file is known to be coming. */
export function preloadOcct(): void {
  void loadOcct().catch(() => {
    /* the real load will surface the error */
  });
}
