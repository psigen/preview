import { describe, expect, it } from 'vitest';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import type { Group } from 'three';
import { usda, usdz } from '../../../../test/gen/writers';
import { readStageInfo, usdaHeaderMetadata } from './units';

const parse = (bytes: ArrayBuffer): Promise<Group> =>
  new Promise((resolve, reject) => new USDLoader().parse(bytes, '', resolve, reject));

const MATRIX = [
  { metersPerUnit: 1, upAxis: 'Y' as const },
  { metersPerUnit: 1, upAxis: 'Z' as const },
  { metersPerUnit: 0.01, upAxis: 'Y' as const },
  { metersPerUnit: 0.01, upAxis: 'Z' as const },
  { metersPerUnit: 0.001, upAxis: 'Y' as const },
  { metersPerUnit: 0.001, upAxis: 'Z' as const },
];

describe('usdaHeaderMetadata', () => {
  it('reads both values straight out of the text', () => {
    const text = new TextDecoder().decode(usda(0.01, 'Z'));
    expect(usdaHeaderMetadata(text)).toEqual({ metersPerUnit: 0.01, upAxis: 'Z' });
  });

  it('returns nulls when a stage declares neither', () => {
    expect(usdaHeaderMetadata('#usda 1.0\n\ndef Mesh "m" {}\n')).toEqual({
      metersPerUnit: null,
      upAxis: null,
    });
  });
});

/**
 * THE CANARY.
 *
 * USDComposer applies metersPerUnit and upAxis to the root and then discards them, so
 * readStageInfo recovers both from the transform. That is coupling to three's internals —
 * r183 did not behave this way at all — and if a future release moves the bake, every
 * measurement in the app silently changes scale with nothing failing.
 *
 * These tests parse each stage AND independently regex its header, then require the two to
 * agree. A three upgrade that relocates the bake breaks this loudly.
 */
describe('stage metadata read back from the transform matches the file', () => {
  it.each(MATRIX)('metersPerUnit=$metersPerUnit upAxis=$upAxis', async ({ metersPerUnit, upAxis }) => {
    const bytes = usda(metersPerUnit, upAxis);
    const declared = usdaHeaderMetadata(new TextDecoder().decode(bytes));
    const inferred = readStageInfo(await parse(bytes));

    expect(inferred.sourceMetersPerUnit).toBeCloseTo(declared.metersPerUnit!, 12);
    expect(inferred.sourceUpAxis).toBe(declared.upAxis);
  });

  it('works through a usdz package too', async () => {
    const inferred = readStageInfo(await parse(usdz(0.001, 'Z')));
    expect(inferred.sourceMetersPerUnit).toBeCloseTo(0.001, 12);
    expect(inferred.sourceUpAxis).toBe('Z');
  });

  it('names the authoring unit when it is a familiar one', async () => {
    expect(readStageInfo(await parse(usda(0.001, 'Y'))).sourceUnit).toBe('mm');
    expect(readStageInfo(await parse(usda(0.01, 'Y'))).sourceUnit).toBe('cm');
    expect(readStageInfo(await parse(usda(1, 'Y'))).sourceUnit).toBe('m');
  });

  /**
   * The whole point of reading it back: the composer SKIPS the scale when metersPerUnit is
   * exactly 1, so an untouched scale of 1 and a declared 1 are indistinguishable — and both
   * are correct.
   */
  it('reports 1 for a metre stage, where the composer applies no scale at all', async () => {
    const root = await parse(usda(1, 'Y'));
    expect(root.scale.x).toBe(1);
    expect(readStageInfo(root).sourceMetersPerUnit).toBe(1);
  });
});
