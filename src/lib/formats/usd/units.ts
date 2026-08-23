import type { Object3D } from 'three';
import { unitFromMetersPerUnit, type UnitId } from '../../units';
import { Z_UP_TO_Y_UP_X_ROTATION } from '../../asset/orient';

/**
 * Recovering what a USD stage declared, after the loader has already consumed it.
 *
 * three's USDComposer applies the stage metadata to the returned root and then throws the
 * values away: `group.scale.setScalar(metersPerUnit)` when it is not 1, and
 * `group.rotation.x = -PI/2` for a Z-up stage. Neither is recorded anywhere readable.
 *
 * So we read them back off the transform. That is coupling to three's internals — r183
 * behaved differently, and a future release could move the bake again — which is why
 * `usdaHeaderMetadata` exists: a USDA file states both in plain text, so a test can check
 * the read-back against the source and fail loudly rather than silently mis-scaling every
 * measurement in the app.
 */
export interface UsdStageInfo {
  /** Metres per one unit of the FILE's own coordinates, e.g. 0.001 for a millimetre stage. */
  readonly sourceMetersPerUnit: number;
  readonly sourceUnit: UnitId | null;
  readonly sourceUpAxis: 'Y' | 'Z';
}

export function readStageInfo(root: Object3D): UsdStageInfo {
  // Correct in both branches: when the composer skips the bake it is because the value was
  // exactly 1, which is what an untouched scale already reads as.
  const sourceMetersPerUnit = root.scale.x;
  const rotated = Math.abs(root.rotation.x - Z_UP_TO_Y_UP_X_ROTATION) < 1e-6;
  return {
    sourceMetersPerUnit,
    sourceUnit: unitFromMetersPerUnit(sourceMetersPerUnit),
    sourceUpAxis: rotated ? 'Z' : 'Y',
  };
}

/**
 * The canary. Parses the two values straight out of a USDA header so a test can compare
 * them with what readStageInfo inferred from the transform.
 *
 * USDA only — a crate file is binary, and USDZ wraps either. The composer path is shared by
 * all three, so proving it on USDA is what covers the rest.
 */
export function usdaHeaderMetadata(
  text: string,
): { metersPerUnit: number | null; upAxis: 'Y' | 'Z' | null } {
  const head = text.slice(0, 4096);
  const mpu = /metersPerUnit\s*=\s*([\d.eE+-]+)/.exec(head);
  const axis = /upAxis\s*=\s*"([YZ])"/.exec(head);
  return {
    metersPerUnit: mpu ? Number(mpu[1]) : null,
    upAxis: (axis?.[1] as 'Y' | 'Z' | undefined) ?? null,
  };
}
