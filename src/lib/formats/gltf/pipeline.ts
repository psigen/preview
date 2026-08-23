import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LoadingManager } from 'three';
import { attachDecoders, hasRenderer } from '../../decoders/gltfDecoders';
import { UNITS_DECLARED, warn, type LoadWarning, type RawAsset } from '../../asset/types';
import type { LoadContext, LoadInput, ScenePipeline } from '../../registry/types';

const decoder = new TextDecoder();

/** Read the JSON chunk of a GLB, or the whole file for a .gltf, without fully parsing it. */
function peekJson(bytes: ArrayBuffer): Record<string, unknown> | null {
  const view = new DataView(bytes);
  try {
    if (view.byteLength > 12 && view.getUint32(0, true) === 0x46546c67) {
      const chunkLength = view.getUint32(12, true);
      const text = decoder.decode(new Uint8Array(bytes, 20, chunkLength));
      return JSON.parse(text) as Record<string, unknown>;
    }
    return JSON.parse(decoder.decode(new Uint8Array(bytes))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * glTF 2.0 and GLB.
 *
 * A `scene` pipeline rather than `geometry`: DRACOLoader spawns its own workers, KTX2 needs
 * a live WebGLRenderer, and Texture objects do not cross a worker boundary. Nesting workers
 * to save nothing would be the wrong trade.
 */
export const gltfPipeline: ScenePipeline = {
  kind: 'scene',

  async load(input: LoadInput, ctx: LoadContext): Promise<RawAsset> {
    ctx.onProgress('Parsing glTF', null);

    const warnings: LoadWarning[] = [];
    const manager = new LoadingManager();

    // Sidecars resolve through the LoadingManager: FileLoader and ImageLoader both honour
    // setURLModifier, so a .gltf finds its .bin and its textures with no loader patching.
    const blobUrls: string[] = [];
    if (input.companions.size > 0) {
      manager.setURLModifier((url) => {
        const key = url.replace(/^\.\//, '').split('?')[0]!.toLowerCase();
        const hit = input.companions.get(key) ?? input.companions.get(key.split('/').pop() ?? '');
        if (!hit) return url;
        const blob = URL.createObjectURL(new Blob([hit.bytes]));
        blobUrls.push(blob);
        return blob;
      });
    }

    const loader = new GLTFLoader(manager);
    const decoders = await attachDecoders(loader);

    // Say what is missing BEFORE parsing fails, so the message names the cause.
    const json = peekJson(input.primary.bytes);
    const required = (json?.extensionsRequired as string[] | undefined) ?? [];
    if (required.includes('KHR_draco_mesh_compression') && !decoders.draco) {
      warnings.push(
        warn(
          'unsupported-feature',
          'This file uses Draco compression, which is unavailable here.',
          'error',
        ),
      );
    }
    if (required.includes('KHR_texture_basisu') && !decoders.ktx2) {
      warnings.push(
        warn(
          'texture-decode-unavailable',
          hasRenderer()
            ? 'KTX2 textures could not be initialised.'
            : 'KTX2 textures need a live WebGL context and were skipped.',
          'warning',
        ),
      );
    }
    for (const ext of required) {
      if (
        !/^KHR_(draco_mesh_compression|texture_basisu|mesh_quantization|materials_|texture_transform|lights_)/.test(
          ext,
        )
      ) {
        warnings.push(
          warn('unsupported-feature', `This file requires the ${ext} extension.`, 'warning'),
        );
      }
    }

    const gltf = await loader.parseAsync(input.primary.bytes, '');
    ctx.signal.throwIfAborted();

    if (gltf.animations.length > 0) {
      warnings.push(
        warn(
          'unsupported-feature',
          `${gltf.animations.length} animation(s) found; playback is not supported yet.`,
          'info',
        ),
      );
    }

    return {
      object: gltf.scene,
      // The spec is explicit: one glTF unit is one metre, and the scene is Y-up. There is no
      // field to read, and no ambiguity to warn about.
      units: UNITS_DECLARED(1, 'm'),
      sourceUpAxis: 'Y',
      orientation: 'file',
      animations: gltf.animations,
      warnings,
      dispose: () => {
        for (const url of blobUrls) URL.revokeObjectURL(url);
        blobUrls.length = 0;
      },
    };
  },
};
