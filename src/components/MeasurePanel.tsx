import { useState } from 'react';
import {
  measurementDelta,
  measurementLength,
  type MeasureAction,
  type MeasureState,
  type SnapKind,
} from '../lib/measure';
import { formatLength, UNITS, type UnitChoice, type UnitSystem } from '../lib/units';

interface Props {
  state: MeasureState;
  dispatch(action: MeasureAction): void;
  metersPerUnit: number | null;
  unit: UnitChoice;
  system: UnitSystem;
  onUnitChange(unit: UnitChoice): void;
  onZoomTo(id: number): void;
}

const SNAP_GLYPH: Record<SnapKind, string> = { vertex: '◆', edge: '—', surface: '·' };
const SNAP_WORD: Record<SnapKind, string> = { vertex: 'vertex', edge: 'edge', surface: 'surface' };

/**
 * The list of measurements, and the single canonical accessible view of them.
 *
 * The in-scene labels are aria-hidden: DOM floating at arbitrary z-order in a 3D scene is
 * noise to a screen reader. This panel is the ordered, focusable, fully-labelled version.
 */
export function MeasurePanel({
  state, dispatch, metersPerUnit, unit, system, onUnitChange, onZoomTo,
}: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const measuring = state.mode === 'point-to-point';

  const describe = (id: number) => {
    const m = state.items.find((x) => x.id === id)!;
    const value = formatLength(measurementLength(m), metersPerUnit, unit, system);
    return { m, value };
  };

  return (
    <section className="panel-glass pad measure-panel" aria-label="Measurements">
      <div className="measure-head">
        <button
          type="button"
          className={measuring ? 'primary' : ''}
          data-action="measure-toggle"
          aria-pressed={measuring}
          onClick={() =>
            dispatch({ type: 'setMode', mode: measuring ? 'off' : 'point-to-point' })
          }
        >
          {measuring ? 'Measuring' : 'Measure'}
        </button>

        <label className="measure-unit">
          <span className="sr-only">Display unit</span>
          <select
            value={unit}
            data-action="measure-unit"
            onChange={(e) => onUnitChange(e.target.value as UnitChoice)}
          >
            <option value="auto">Auto</option>
            {(['mm', 'cm', 'm', 'km', 'in', 'ft'] as const).map((u) => (
              <option key={u} value={u} disabled={metersPerUnit === null}>
                {UNITS[u].id}
              </option>
            ))}
          </select>
        </label>
      </div>

      {measuring && state.items.length === 0 && (
        <p className="hint">
          {state.draft.phase === 'first'
            ? 'Click a second point to finish.'
            : 'Click two points on the surface.'}
        </p>
      )}

      {metersPerUnit === null && state.items.length > 0 && (
        <p className="hint">
          This file declares no units, so lengths are shown in model units.
        </p>
      )}

      {state.items.length > 0 && (
        <ul className="measure-list">
          {state.items.map((m, index) => {
            const { value } = describe(m.id);
            const selected = m.id === state.selectedId;
            const delta = measurementDelta(m);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  className={`measure-row${selected ? ' selected' : ''}`}
                  data-measure-row={m.id}
                  aria-pressed={selected}
                  // Spelled out in words: the glyphs mean nothing read aloud.
                  aria-label={`Measurement ${index + 1}, ${value.text}, ${SNAP_WORD[m.a.snap]} to ${SNAP_WORD[m.b.snap]}`}
                  onClick={() => dispatch({ type: 'select', id: selected ? null : m.id })}
                >
                  <span className="measure-value">{value.text}</span>
                  <span className="measure-snap" aria-hidden="true">
                    {SNAP_GLYPH[m.a.snap]} {SNAP_GLYPH[m.b.snap]}
                  </span>
                </button>
                <div className="measure-actions">
                  <button type="button" className="link" title="Zoom to" onClick={() => onZoomTo(m.id)}>
                    ⌖
                  </button>
                  <button
                    type="button"
                    className="link"
                    title="Delete"
                    data-measure-delete={m.id}
                    onClick={() => dispatch({ type: 'delete', id: m.id })}
                  >
                    ✕
                  </button>
                </div>
                {selected && (
                  <dl className="stat-list measure-detail">
                    {(['ΔX', 'ΔY', 'ΔZ'] as const).map((axis, i) => (
                      <div className="stat-row" key={axis}>
                        <dt className="stat-key">{axis}</dt>
                        <dd className="stat-value">
                          {formatLength(delta[i]!, metersPerUnit, unit, system).text}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {state.items.length > 0 && (
        <button
          type="button"
          className="link"
          data-action="measure-clear"
          onClick={() => {
            if (confirmClear) {
              dispatch({ type: 'clear' });
              setConfirmClear(false);
            } else {
              setConfirmClear(true);
              window.setTimeout(() => setConfirmClear(false), 3000);
            }
          }}
        >
          {confirmClear ? 'Clear all — sure?' : 'Clear all'}
        </button>
      )}
    </section>
  );
}
