import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import type { Group } from 'three';
import { UNITS_DECLARED, warn, type LoadWarning, type RawAsset } from '../../asset/types';
import type { LoadContext, LoadInput, ScenePipeline } from '../../registry/types';
import { readStageInfo } from './units';

/**
 * OpenUSD: .usda text, .usdc crate, and .usdz packages containing either.
 *
 * Handled entirely in JavaScript by three r185's USDLoader — no extra wasm — which is the
 * single biggest simplification in the whole design.
 *
 * A `scene` pipeline, and it has no choice: USDComposer calls `new Image()` synchronously
 * while composing a textured material, and Image exists in no worker scope.
 */
export const usdPipeline: ScenePipeline = {
  kind: 'scene',

  async load(input: LoadInput, ctx: LoadContext): Promise<RawAsset> {
    ctx.onProgress('Parsing USD', null);

    const loader = new USDLoader();
    const root = await new Promise<Group>((resolve, reject) => {
      try {
        loader.parse(input.primary.bytes, '', resolve, reject);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    ctx.signal.throwIfAborted();

    const stage = readStageInfo(root);
    const warnings: LoadWarning[] = [];

    const animations = (root as Group & { animations?: never[] }).animations ?? [];
    if (animations.length > 0) {
      warnings.push(
        warn('unsupported-feature', `${animations.length} animation(s) found; playback is not supported yet.`, 'info'),
      );
    }

    return {
      object: root,
      /**
       * ONE, not the stage's own metersPerUnit.
       *
       * The contract is metres per WORLD unit after any transform the loader baked in, and
       * USDLoader has already scaled the root so that world space is metres. Reporting the
       * stage value here would apply the conversion twice.
       */
      units: UNITS_DECLARED(1, stage.sourceUnit ?? undefined),
      sourceUpAxis: stage.sourceUpAxis,
      // The loader rotated a Z-up stage itself, so the finaliser must not rotate it again.
      orientation: 'y-up',
      animations,
      warnings,
    };
  },
};
