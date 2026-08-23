/**
 * Length units, conversion, and display formatting.
 *
 * Pure: no three, no DOM, no React. Every function here is unit-testable in plain Node, and
 * this module is deliberately built before any WebGL exists.
 *
 * The one contract everything else depends on:
 *
 *   metersPerUnit — multiply a distance measured in the WORLD space of the loaded model
 *   (after updateMatrixWorld) by this to get metres, AFTER any transform a loader already
 *   baked in. A loader that bakes a unit scale into its root must report 1.
 *
 * `null` means the file declared nothing. We then show a bare number with a 'u' suffix and
 * never invent a scale — see CLAUDE.md.
 */

export type UnitId = 'mm' | 'cm' | 'm' | 'km' | 'in' | 'ft' | 'u';
/** 'auto' picks a unit from the magnitude; anything else pins it. */
export type UnitChoice = 'auto' | UnitId;
export type UnitSystem = 'metric' | 'imperial';

export interface UnitDef {
  readonly id: UnitId;
  readonly label: string;
  readonly plural: string;
  /** Metres in one of this unit. Meaningless for the abstract unit. */
  readonly metersPer: number;
  readonly abstract: boolean;
  /** Never show fewer decimals than this, even when the significant-figure rule wants to. */
  readonly minDecimals: number;
  /** Never show more than this, however small the value. */
  readonly maxDecimals: number;
}

/**
 * Significant figures targeted by the display rule.
 *
 * Five rather than four: at part scale that preserves 0.01 mm, and it keeps a metre-scale
 * reading at 0.1 mm instead of rounding 1234.5 mm away to "1.234 m". The per-unit
 * maxDecimals caps stop it running past any real-world tolerance (mm never exceeds 3
 * decimals, which is already a micron).
 */
export const SIGNIFICANT_FIGURES = 5;

/**
 * Formatting is pinned: this is a lookup table, aligned so the columns compare down the
 * page. One property per line turns 7 rows into 49 and it stops reading as a table.
 */
// prettier-ignore
export const UNITS: Readonly<Record<UnitId, UnitDef>> = Object.freeze({
  mm: { id: 'mm', label: 'millimetre', plural: 'millimetres', metersPer: 1e-3, abstract: false, minDecimals: 2, maxDecimals: 3 },
  cm: { id: 'cm', label: 'centimetre', plural: 'centimetres', metersPer: 1e-2, abstract: false, minDecimals: 2, maxDecimals: 3 },
  m:  { id: 'm',  label: 'metre',      plural: 'metres',      metersPer: 1,    abstract: false, minDecimals: 3, maxDecimals: 4 },
  km: { id: 'km', label: 'kilometre',  plural: 'kilometres',  metersPer: 1e3,  abstract: false, minDecimals: 3, maxDecimals: 4 },
  in: { id: 'in', label: 'inch',       plural: 'inches',      metersPer: 0.0254, abstract: false, minDecimals: 2, maxDecimals: 4 },
  ft: { id: 'ft', label: 'foot',       plural: 'feet',        metersPer: 0.3048, abstract: false, minDecimals: 3, maxDecimals: 4 },
  u:  { id: 'u',  label: 'unit',       plural: 'units',       metersPer: NaN,  abstract: true,  minDecimals: 2, maxDecimals: 4 },
});

const METRIC_UNITS: readonly UnitId[] = ['mm', 'cm', 'm', 'km'];
const IMPERIAL_UNITS: readonly UnitId[] = ['in', 'ft'];

/* ------------------------------------------------------------------ conversion */

export function toMeters(worldDistance: number, metersPerUnit: number): number {
  return worldDistance * metersPerUnit;
}

export function fromMeters(meters: number, unit: UnitId): number {
  const def = UNITS[unit];
  return def.abstract ? meters : meters / def.metersPer;
}

/**
 * Pick a display unit from the magnitude.
 *
 * Metric deliberately skips centimetres — mechanical drawings use mm or m, and an
 * auto-selected "cm" reads as a mistake. It stays available as an explicit pin.
 * Imperial stops at feet; nobody measures a CAD part in miles.
 */
export function autoUnit(meters: number, system: UnitSystem): UnitId {
  const a = Math.abs(meters);
  if (system === 'imperial') return a < UNITS.ft.metersPer ? 'in' : 'ft';
  if (a < 1) return 'mm';
  if (a < 1000) return 'm';
  return 'km';
}

/** Closest unit whose metersPer matches the given scale, for labelling a declared unit. */
export function unitFromMetersPerUnit(metersPerUnit: number): UnitId | null {
  for (const id of [...METRIC_UNITS, ...IMPERIAL_UNITS]) {
    if (Math.abs(UNITS[id].metersPer - metersPerUnit) <= Math.abs(metersPerUnit) * 1e-9) return id;
  }
  return null;
}

/* ------------------------------------------------------------------ formatting */

/**
 * Decimal places for a value: SIGNIFICANT_FIGURES significant digits, floored by the unit's
 * minDecimals and capped by its maxDecimals.
 */
export function decimalsFor(value: number, unit: UnitId): number {
  const def = UNITS[unit];
  if (!Number.isFinite(value)) return def.minDecimals;
  const magnitude = value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)));
  const wanted = SIGNIFICANT_FIGURES - 1 - magnitude;
  return Math.min(Math.max(wanted, def.minDecimals), def.maxDecimals);
}

export interface FormattedLength {
  /** Ready to render, e.g. '124.53 mm'. */
  readonly text: string;
  /** The numeric part, already converted into `unit`. */
  readonly value: number;
  readonly unit: UnitId;
  readonly decimals: number;
  /** True when the source declared no units, so `value` is in abstract model units. */
  readonly abstract: boolean;
}

const NON_FINITE: FormattedLength = Object.freeze({
  text: '—',
  value: NaN,
  unit: 'u',
  decimals: 0,
  abstract: true,
});

/**
 * Format a world-space distance for display.
 *
 * @param worldDistance a length in the model's world space.
 * @param metersPerUnit the units contract above, or null when the file declared nothing.
 * @param choice 'auto' to pick by magnitude, or a pinned unit.
 * @param system which family 'auto' should choose from.
 */
export function formatLength(
  worldDistance: number,
  metersPerUnit: number | null,
  choice: UnitChoice = 'auto',
  system: UnitSystem = 'metric',
): FormattedLength {
  if (!Number.isFinite(worldDistance)) return NON_FINITE;

  // No declared units: show the raw number. Never guess a scale.
  if (metersPerUnit === null || !Number.isFinite(metersPerUnit)) {
    const decimals = decimalsFor(worldDistance, 'u');
    return {
      text: `${worldDistance.toFixed(decimals)} u`,
      value: worldDistance,
      unit: 'u',
      decimals,
      abstract: true,
    };
  }

  const meters = toMeters(worldDistance, metersPerUnit);
  // A pinned abstract unit on a model that does have units is meaningless; fall back to auto.
  const unit = choice === 'auto' || choice === 'u' ? autoUnit(meters, system) : choice;
  const value = fromMeters(meters, unit);
  const decimals = decimalsFor(value, unit);
  return { text: `${value.toFixed(decimals)} ${unit}`, value, unit, decimals, abstract: false };
}

/** Format a bounding-box extent triple, e.g. '10.00 × 20.00 × 30.00 mm'. */
export function formatDims(
  dims: readonly [number, number, number],
  metersPerUnit: number | null,
  choice: UnitChoice = 'auto',
  system: UnitSystem = 'metric',
): string {
  // Choose one unit for all three axes, driven by the largest, so they stay comparable.
  const largest = Math.max(...dims.map(Math.abs));
  const ref = formatLength(largest, metersPerUnit, choice, system);
  if (!Number.isFinite(largest)) return NON_FINITE.text;

  const parts = dims.map((d) => {
    const f = formatLength(d, metersPerUnit, ref.unit === 'u' ? 'auto' : ref.unit, system);
    return f.value.toFixed(ref.decimals);
  });
  return `${parts.join(' × ')} ${ref.unit}`;
}
