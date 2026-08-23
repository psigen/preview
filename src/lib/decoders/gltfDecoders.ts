import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { WebGLRenderer } from 'three';
import { vendorUrl } from './assetUrl';

/**
 * Compression and texture decoders for glTF.
 *
 * All three are optional extensions, and all three behave differently:
 *
 *  - meshopt is a plain ES module with its wasm inlined, so it just bundles.
 *  - Draco needs its decoder fetched at runtime from a stable, unhashed directory, because
 *    setDecoderPath concatenates filenames onto it.
 *  - KTX2 additionally needs a live WebGLRenderer to know which compressed texture formats
 *    the GPU supports. There is no renderer in Node, so KTX2 is simply unavailable there.
 *
 * Instances are memoised: each one owns a worker pool, and creating a DRACOLoader per file
 * would spawn a new pool per load.
 */

let renderer: WebGLRenderer | null = null;

/** Called once by the viewer. Without it, KTX2 textures cannot be decoded. */
export function setDecoderRenderer(gl: WebGLRenderer | null): void {
  renderer = gl;
}

export function hasRenderer(): boolean {
  return renderer !== null;
}

let dracoPromise: Promise<unknown> | null = null;
let ktx2Promise: Promise<unknown> | null = null;
let meshoptPromise: Promise<unknown> | null = null;

async function draco() {
  if (!dracoPromise) {
    dracoPromise = import('three/addons/loaders/DRACOLoader.js').then(({ DRACOLoader }) => {
      const loader = new DRACOLoader();
      loader.setDecoderPath(vendorUrl('draco/gltf/'));
      return loader;
    });
  }
  return dracoPromise;
}

async function ktx2() {
  if (!ktx2Promise) {
    ktx2Promise = import('three/addons/loaders/KTX2Loader.js').then(({ KTX2Loader }) => {
      const loader = new KTX2Loader();
      loader.setTranscoderPath(vendorUrl('basis/'));
      return loader;
    });
  }
  return ktx2Promise;
}

async function meshopt() {
  if (!meshoptPromise) {
    // Deliberately NOT calling useWorkers(): the default synchronous WebAssembly path keeps
    // meshopt usable in Node, which is where the format tests run.
    meshoptPromise = import('three/addons/libs/meshopt_decoder.module.js').then(
      (m) => m.MeshoptDecoder,
    );
  }
  return meshoptPromise;
}

export interface DecoderReport {
  readonly draco: boolean;
  readonly ktx2: boolean;
  readonly meshopt: boolean;
}

/** Attach whatever decoders this environment can actually run. */
export async function attachDecoders(loader: GLTFLoader): Promise<DecoderReport> {
  const report = { draco: false, ktx2: false, meshopt: false };

  try {
    loader.setMeshoptDecoder((await meshopt()) as never);
    report.meshopt = true;
  } catch {
    /* meshopt-compressed files will fail with the loader's own message */
  }

  // Draco spawns a worker, which exists in a browser but not under Node.
  if (typeof Worker !== 'undefined') {
    try {
      loader.setDRACOLoader((await draco()) as never);
      report.draco = true;
    } catch {
      /* Draco-compressed files will fail with the loader's own message */
    }
  }

  if (renderer && typeof Worker !== 'undefined') {
    try {
      const loaderKtx2 = (await ktx2()) as { detectSupport(r: WebGLRenderer): unknown };
      loaderKtx2.detectSupport(renderer);
      loader.setKTX2Loader(loaderKtx2 as never);
      report.ktx2 = true;
    } catch {
      /* KTX2 textures will fail with the loader's own message */
    }
  }

  return report;
}
