import { describe, expect, it } from 'vitest';
import { DIAGONAL_ABSTRACT, DIAGONAL_M } from '../../test/gen/box';
import {
  UNITS,
  SIGNIFICANT_FIGURES,
  autoUnit,
  decimalsFor,
  formatDims,
  formatLength,
  fromMeters,
  toMeters,
  unitFromMetersPerUnit,
  type UnitChoice,
  type UnitId,
  type UnitSystem,
} from './units';

describe('unit table', () => {
  it('defines exactly one abstract unit', () => {
    const abstract = Object.values(UNITS).filter((u) => u.abstract);
    expect(abstract.map((u) => u.id)).toEqual(['u']);
  });

  it('has a sane decimal range for every unit', () => {
    for (const u of Object.values(UNITS)) {
      expect(u.minDecimals, u.id).toBeLessThanOrEqual(u.maxDecimals);
      expect(u.minDecimals, u.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses the exact international inch and foot', () => {
    expect(UNITS.in.metersPer).toBe(0.0254);
    expect(UNITS.ft.metersPer).toBe(0.3048);
    expect(fromMeters(1, 'in')).toBeCloseTo(39.37007874015748, 12);
    expect(fromMeters(1, 'ft')).toBeCloseTo(3.280839895013123, 12);
  });

  it('round-trips through metres', () => {
    for (const id of ['mm', 'cm', 'm', 'km', 'in', 'ft'] as UnitId[]) {
      expect(fromMeters(toMeters(1234.5, UNITS[id].metersPer), id)).toBeCloseTo(1234.5, 9);
    }
  });
});

describe('autoUnit', () => {
  it.each([
    [0, 'mm'],
    [1e-6, 'mm'],
    [0.999, 'mm'],
    [1, 'm'],
    [999, 'm'],
    [1000, 'km'],
    [1e6, 'km'],
  ] as const)('metric: %f m -> %s', (m, want) => {
    expect(autoUnit(m, 'metric')).toBe(want);
  });

  it.each([
    [0, 'in'],
    [0.3047, 'in'],
    [0.3048, 'ft'],
    [1000, 'ft'],
  ] as const)('imperial: %f m -> %s', (m, want) => {
    expect(autoUnit(m, 'imperial')).toBe(want);
  });

  it('never auto-selects centimetres — a drawing is in mm or m', () => {
    const picked = new Set([0.001, 0.05, 0.5, 5, 5000].map((m) => autoUnit(m, 'metric')));
    expect(picked.has('cm')).toBe(false);
  });

  it('uses magnitude, so a negative distance picks the same unit', () => {
    expect(autoUnit(-0.5, 'metric')).toBe(autoUnit(0.5, 'metric'));
  });
});

describe('decimalsFor', () => {
  it(`targets ${SIGNIFICANT_FIGURES} significant figures between the unit's floor and ceiling`, () => {
    expect(decimalsFor(124.53, 'mm')).toBe(2); // 5 sig figs wants 2
    expect(decimalsFor(8.2043, 'mm')).toBe(3); // wants 4, capped at mm's 3
    expect(decimalsFor(1000, 'mm')).toBe(2); //   wants 1, floored at mm's 2
    expect(decimalsFor(1.2345, 'm')).toBe(4); //  wants 4, within m's 3..4
  });

  it('treats zero as magnitude zero rather than -Infinity', () => {
    expect(decimalsFor(0, 'mm')).toBe(3);
    expect(Number.isFinite(decimalsFor(0, 'm'))).toBe(true);
  });

  it('is magnitude-symmetric about zero', () => {
    expect(decimalsFor(-124.53, 'mm')).toBe(decimalsFor(124.53, 'mm'));
  });
});

/**
 * The worked table. These are the strings a user actually reads, so they are pinned
 * literally rather than recomputed from the same formula the code uses.
 */
describe('formatLength', () => {
  const CASES: ReadonlyArray<readonly [number, number | null, UnitChoice, UnitSystem, string]> = [
    [124.53, 0.001, 'auto', 'metric', '124.53 mm'],
    [8.2043, 0.001, 'auto', 'metric', '8.204 mm'],
    [1234.5, 0.001, 'auto', 'metric', '1.2345 m'],
    [1000, 0.001, 'mm', 'metric', '1000.00 mm'],
    [124.53, 0.001, 'auto', 'imperial', '4.9028 in'],
    [0.3048, 1, 'auto', 'imperial', '1.0000 ft'],
    [0.3047, 1, 'auto', 'imperial', '11.996 in'],
    [1, 1, 'auto', 'metric', '1.0000 m'],
    [999, 1, 'auto', 'metric', '999.000 m'],
    [1000, 1, 'auto', 'metric', '1.0000 km'],
    [0, 0.001, 'auto', 'metric', '0.000 mm'],
    [124.53, null, 'auto', 'metric', '124.53 u'],
  ];

  it.each(CASES)('%f x %s as %s/%s -> %s', (world, mpu, choice, system, want) => {
    expect(formatLength(world, mpu, choice, system).text).toBe(want);
  });

  it('returns an em dash rather than "NaN mm" for non-finite input', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(formatLength(bad, 0.001).text).toBe('—');
    }
  });

  it('falls back to abstract when metersPerUnit is not finite', () => {
    expect(formatLength(12, NaN).abstract).toBe(true);
    expect(formatLength(12, null).unit).toBe('u');
  });

  it('marks a declared-unit result as not abstract', () => {
    expect(formatLength(12, 0.001).abstract).toBe(false);
  });

  it('ignores a pinned "u" when the model does have units', () => {
    // Pinning the abstract unit on a model with real units is meaningless, not an error.
    expect(formatLength(30, 0.001, 'u').unit).toBe('mm');
  });

  it('reports the converted value and decimals alongside the text', () => {
    const f = formatLength(1234.5, 0.001);
    expect(f.unit).toBe('m');
    expect(f.value).toBeCloseTo(1.2345, 9);
    expect(f.decimals).toBe(4);
  });
});

describe('the canonical box diagonal', () => {
  // The single number every format must agree on. See test/gen/box.ts.
  it('reads as millimetres when the source declares units', () => {
    expect(formatLength(DIAGONAL_M, 1).text).toBe('37.417 mm');
  });

  it('reads as bare units when it does not', () => {
    expect(formatLength(DIAGONAL_ABSTRACT, null).text).toBe('37.417 u');
  });

  it('is the same physical length either way', () => {
    expect(DIAGONAL_ABSTRACT * 1e-3).toBeCloseTo(DIAGONAL_M, 12);
  });
});

describe('formatDims', () => {
  it('uses one unit and one precision across all three axes', () => {
    expect(formatDims([10, 20, 30], 0.001)).toBe('10.000 × 20.000 × 30.000 mm');
  });

  it('drops to bare units when nothing is declared', () => {
    expect(formatDims([10, 20, 30], null)).toBe('10.000 × 20.000 × 30.000 u');
  });

  it('picks the unit from the largest axis so the three stay comparable', () => {
    // 2000 mm crosses into metres; the small axes must follow rather than switch units.
    expect(formatDims([1, 1, 2000], 0.001)).toBe('0.0010 × 0.0010 × 2.0000 m');
  });

  it('handles a non-finite extent', () => {
    expect(formatDims([1, NaN, 3], 0.001)).toBe('—');
  });
});

describe('unitFromMetersPerUnit', () => {
  it.each([
    [1e-3, 'mm'],
    [1e-2, 'cm'],
    [1, 'm'],
    [1e3, 'km'],
    [0.0254, 'in'],
    [0.3048, 'ft'],
  ] as const)('%f -> %s', (mpu, want) => {
    expect(unitFromMetersPerUnit(mpu)).toBe(want);
  });

  it('returns null for a scale that is not a named unit', () => {
    expect(unitFromMetersPerUnit(0.5)).toBeNull();
    expect(unitFromMetersPerUnit(0)).toBeNull();
  });
});
