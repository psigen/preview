/**
 * Turning a plugin's RawAsset into a LoadedModel.
 *
 * This is the one place requirements 3, 4 and 5 are enforced — units reported against world
 * space, up-axis normalised exactly once, and no fit or normalisation scale ever baked in.
 * Every plugin funnels through here, so no plugin can get those wrong on its own.
 */
import type { FormatId } from '../format-id';
import { disposeObject } from '../asset/dispose';
import { worldFromFile, wrapForUpAxis } from '../asset/orient';
import { computeStats } from '../asset/stats';
import type { LoadedModel, LoadWarning, RawAsset } from '../asset/types';
import { warn } from '../asset/types';

export interface FinalizeMeta {
  readonly id: number;
  readonly name: string;
  readonly format: FormatId;
  /** Byte length of the source file. */
  readonly bytes: number;
  readonly parseMs: number;
}

export function finalize(raw: RawAsset, meta: FinalizeMeta): LoadedModel {
  const wrapper = wrapForUpAxis(raw.object, raw.orientation, raw.sourceUpAxis, meta.name);
  const matrix = worldFromFile(raw.object);
  const animations = raw.animations ?? [];
  const stats = computeStats(wrapper, {
    bytes: meta.bytes,
    parseMs: meta.parseMs,
    animations: animations.length,
  });

  const warnings: LoadWarning[] = [...(raw.warnings ?? [])];

  if (!raw.units.known) {
    warnings.push(warn('units-unknown', raw.units.reason, 'info'));
  }
  if (raw.sourceUpAxis === 'unknown') {
    warnings.push(
      warn(
        'up-axis-unknown',
        'This format does not record an up axis, so the model is shown exactly as authored. ' +
          'It may appear lying on its side if it was made in a Z-up tool.',
        'info',
      ),
    );
  }
  // Order matters: an empty model and a model full of NaN both leave stats.valid false, but
  // they are different failures and deserve different messages. "Nothing to draw" is the
  // more specific diagnosis, so it wins. (A curves-only IGES really does reach here — OCCT
  // returns success with zero meshes; see docs/SPIKES.md S3.)
  if (stats.meshes === 0 && stats.points === 0) {
    warnings.push(warn('degenerate-geometry', 'No renderable geometry was found in this file.', 'error'));
  } else if (!stats.valid) {
    warnings.push(
      warn(
        'non-finite-geometry',
        'The geometry contains invalid coordinates, so the model could not be measured or framed.',
        'error',
      ),
    );
  }

  let disposed = false;
  return {
    id: meta.id,
    name: meta.name,
    format: meta.format,
    object: wrapper,
    units: raw.units,
    sourceUpAxis: raw.sourceUpAxis,
    worldFromFile: matrix,
    animations,
    stats,
    warnings,
    dispose() {
      if (disposed) return; // idempotent: StrictMode and an explicit replace may both call
      disposed = true;
      disposeObject(wrapper);
      raw.dispose?.();
    },
  };
}
