import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DropOverlay } from './components/DropOverlay';
import { EmptyState } from './components/EmptyState';
import { MeasurePanel } from './components/MeasurePanel';
import { StatusBar } from './components/StatusBar';
import { Viewer } from './components/Viewer';
import { ViewToolbar } from './components/ViewToolbar';
import { useHotkeys } from './hooks/useHotkeys';
import { useModelLoader } from './hooks/useModelLoader';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';
import { useWindowDrop } from './hooks/useWindowDrop';
import { computeBounds } from './lib/bounds';
import type { ViewId } from './lib/camera';
import { acceptAttribute } from './lib/detect/detect';
import type { DroppedFile } from './lib/dnd';
import { filesFromList } from './lib/dropEntries';
import { assessModel } from './lib/limits';
import { initialMeasureState, measureReducer, sphereAround } from './lib/measure';
import { sampleById } from './lib/samples';
import { formatDims, formatLength, type UnitChoice } from './lib/units';
import type { ViewApi } from './types';

export function App() {
  const [activeView, setActiveView] = useState<ViewId | null>(null);
  const apiRef = useRef<ViewApi | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const reduceMotion = usePrefersReducedMotion();

  const [measure, dispatchMeasure] = useReducer(measureReducer, initialMeasureState);
  const [unit, setUnit] = useState<UnitChoice>('auto');

  const { model, busy, error, pendingLarge, open, dismissError } = useModelLoader();
  const dragging = useWindowDrop({ onFiles: open, disabled: busy !== null });

  useHotkeys(
    useCallback((action) => {
      if (action.kind === 'fit') apiRef.current?.fit();
      else apiRef.current?.applyView(action.view);
    }, []),
    model !== null,
  );

  // A measurement is a pair of world-space points, meaningless against different geometry.
  useEffect(() => {
    dispatchMeasure({ type: 'reset' });
  }, [model]);

  // Escape is a ladder: abandon the half-finished measurement first, then the selection,
  // then leave the tool. Anything else throws away more than the user asked to.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (measure.draft.phase === 'first') dispatchMeasure({ type: 'cancelDraft' });
      else if (measure.selectedId !== null) dispatchMeasure({ type: 'select', id: null });
      else if (measure.mode !== 'off') dispatchMeasure({ type: 'setMode', mode: 'off' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [measure.draft.phase, measure.selectedId, measure.mode]);

  const zoomToMeasurement = useCallback(
    (id: number) => {
      const m = measure.items.find((x) => x.id === id);
      if (!m) return;
      const s = sphereAround(m.a.p, m.b.p);
      apiRef.current?.fitSphere(s.center, s.radius);
    },
    [measure.items],
  );

  const openSample = useCallback(
    (id: string) => {
      const sample = sampleById(id);
      const file = new File([sample.bytes()], sample.fileName);
      open([{ path: sample.fileName, file }]);
    },
    [open],
  );

  const onPickFiles = useCallback((files: DroppedFile[]) => open(files), [open]);

  const bounds = useMemo(() => (model ? computeBounds(model.object) : null), [model]);
  const assessment = useMemo(
    () => (model ? assessModel(model.stats.triangles, model.stats.bytes) : null),
    [model],
  );

  const mpu = model?.units.known ? model.units.metersPerUnit : null;
  const rows: [string, string][] =
    model && bounds
      ? [
          ['Format', model.format.toUpperCase()],
          ['Triangles', model.stats.triangles.toLocaleString('en-US')],
          ['Points', model.stats.points.toLocaleString('en-US')],
          ['Dimensions', formatDims(model.stats.size, mpu)],
          ['Diagonal', formatLength(Math.hypot(...model.stats.size), mpu).text],
          ['Units', model.units.known ? 'declared' : 'not declared'],
        ]
      : [];

  return (
    <div className="viewer-app">
      {model && bounds && (
        <Viewer
          model={model}
          bounds={bounds}
          apiRef={apiRef}
          onActiveViewChange={setActiveView}
          reduceMotion={reduceMotion}
          measure={measure}
          dispatchMeasure={dispatchMeasure}
          unit={unit}
          system="metric"
        />
      )}

      {!model && !busy && (
        <EmptyState onFiles={onPickFiles} onSample={openSample} disabled={busy !== null} />
      )}

      {model && (
        <>
          <div className="hud hud-top-left">
            <div className="panel-glass pad">
              <strong>preview</strong>
              <p className="filename" title={model.name}>
                {model.name}
              </p>
              {/* Replacing a model never goes through the empty state: the window-wide drop
                  target is armed whenever nothing is loading, and this is its click twin. */}
              <button
                type="button"
                className="link"
                data-action="replace"
                onClick={() => replaceInput.current?.click()}
              >
                Open another…
              </button>
              <input
                ref={replaceInput}
                type="file"
                hidden
                multiple
                accept={acceptAttribute()}
                onChange={(e) => {
                  const list = e.target.files;
                  if (list?.length) open(filesFromList(list));
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <div className="hud hud-left">
            <ViewToolbar apiRef={apiRef} activeView={activeView} />
          </div>

          <div className="hud hud-right">
            <MeasurePanel
              state={measure}
              dispatch={dispatchMeasure}
              metersPerUnit={mpu}
              unit={unit}
              system="metric"
              onUnitChange={setUnit}
              onZoomTo={zoomToMeasurement}
            />
            <section className="panel-glass pad" aria-label="Model information">
              <dl className="stat-list">
                {rows.map(([key, value]) => (
                  <div className="stat-row" key={key}>
                    <dt className="stat-key">{key}</dt>
                    <dd className="stat-value" data-stat={key.toLowerCase()}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {assessment?.messages.map((m) => (
                <p className="hint warn" key={m}>
                  {m}
                </p>
              ))}
              {model.warnings.length > 0 && (
                <ul className="warning-list">
                  {model.warnings.map((w) => (
                    <li key={w.code} className={w.severity === 'error' ? 'error' : 'hint'}>
                      {w.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <div className="hud hud-bottom">
        <StatusBar
          busy={busy}
          error={error}
          pendingLarge={pendingLarge}
          onDismissError={dismissError}
        />
      </div>

      {dragging && <DropOverlay />}
    </div>
  );
}
