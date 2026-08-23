import { LoadingManager } from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { UNITS_UNKNOWN, warn, type LoadWarning, type RawAsset } from '../../asset/types';
import type { AssetFile, LoadContext, LoadInput, ScenePipeline } from '../../registry/types';

const decoder = new TextDecoder();

/** The .mtl a file asks for, if any. OBJ may reference several; the first is what matters. */
function materialLibraryName(objText: string): string | null {
  const match = /^\s*mtllib\s+(.+)$/m.exec(objText);
  return match?.[1]?.trim().split(/\s+/)[0] ?? null;
}

/** Companions are keyed by relative path, but an OBJ may reference a bare filename. */
function findCompanion(companions: LoadInput['companions'], name: string): AssetFile | undefined {
  const key = name.replace(/^\.\//, '').toLowerCase();
  const direct = companions.get(key);
  if (direct) return direct;
  const base = key.split('/').pop() ?? key;
  for (const [path, file] of companions) {
    if (path.toLowerCase().endsWith(`/${base}`) || path.toLowerCase() === base) return file;
  }
  return undefined;
}

/**
 * Wavefront OBJ, with its companion MTL.
 *
 * A `scene` pipeline. OBJLoader itself is entirely DOM-free and would be the best candidate
 * of any format for a worker — text parsing is the slow part — but MTLLoader reaches for
 * TextureLoader, which needs a document. Splitting geometry-to-worker and materials-on-main
 * is a clean future win rather than something to do speculatively.
 */
export const objPipeline: ScenePipeline = {
  kind: 'scene',

  async load(input: LoadInput, ctx: LoadContext): Promise<RawAsset> {
    ctx.onProgress('Parsing OBJ', null);

    const objText = decoder.decode(new Uint8Array(input.primary.bytes));
    const warnings: LoadWarning[] = [];
    const blobUrls: string[] = [];

    const manager = new LoadingManager();
    // Textures referenced by the MTL resolve out of the drop, exactly as glTF's do.
    manager.setURLModifier((url) => {
      const hit = findCompanion(input.companions, url.split('?')[0] ?? url);
      if (!hit) return url;
      const blob = URL.createObjectURL(new Blob([hit.bytes]));
      blobUrls.push(blob);
      return blob;
    });

    const objLoader = new OBJLoader(manager);

    const libraryName = materialLibraryName(objText);
    if (libraryName) {
      const mtlFile = findCompanion(input.companions, libraryName);
      if (mtlFile) {
        const mtlLoader = new MTLLoader(manager);
        const materials = mtlLoader.parse(decoder.decode(new Uint8Array(mtlFile.bytes)), '');
        materials.preload();
        objLoader.setMaterials(materials);
      } else {
        // The geometry still loads; say why it is plain grey rather than leaving the user
        // to wonder.
        warnings.push(
          warn(
            'missing-companion',
            `This OBJ references "${libraryName}", which was not included. ` +
              'Drop the folder, or both files together, to get its materials.',
            'warning',
          ),
        );
      }
    }

    const object = objLoader.parse(objText);
    ctx.signal.throwIfAborted();

    return {
      object,
      units: UNITS_UNKNOWN('OBJ files do not record units, so distances are shown in model units.'),
      // OBJ has no orientation field. It is usually Y-up, coming from DCC tools, but the
      // file never says so and rotating the ones that are not would be worse.
      sourceUpAxis: 'unknown',
      orientation: 'file',
      warnings,
      dispose: () => {
        for (const url of blobUrls) URL.revokeObjectURL(url);
        blobUrls.length = 0;
      },
    };
  },
};
