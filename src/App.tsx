import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { About } from './About';
import { DropOverlay } from './components/DropOverlay';
import { EmptyState } from './components/EmptyState';
import { MeasurePanel } from './components/MeasurePanel';
import { StatusBar } from './components/StatusBar';
import { Viewer } from './components/Viewer';
import { ViewToolbar } from './components/ViewToolbar';
import { closeHashRoute, useHashRoute } from './hooks/useHashRoute';
import { useHotkeys } from './hooks/useHotkeys';
import { useModelLoader } from './hooks/useModelLoader';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';
import { useWindowDrop } from './hooks/useWindowDrop';
import { computeBounds } from './lib/bounds';
import type { ViewId } from './lib/camera';
import type { DroppedFile } from './lib/dnd';
import { assessModel } from './lib/limits';
import { initialMeasureState, measureReducer, sphereAround } from './lib/measure';
import { sampleById, sampleBytes } from './lib/samples';
import { formatDims, formatLength, type UnitChoice } from './lib/units';
import type { ViewApi } from './types';

export function App() {
  const [activeView, setActiveView] = useState<ViewId | null>(null);
  const apiRef = useRef<ViewApi | null>(null);
  const reduceMotion = usePrefersReducedMotion();
  const route = useHashRoute();

  const [measure, dispatchMeasure] = useReducer(measureReducer, initialMeasureState);
  const [unit, setUnit] = useState<UnitChoice>('auto');

  const { model, busy, error, pendingLarge, open, clear, dismissError } = useModelLoader();
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
      // The About dialog is modal, so it gets the key before anything behind it.
      if (route === 'about') closeHashRoute();
      else if (measure.draft.phase === 'first') dispatchMeasure({ type: 'cancelDraft' });
      else if (measure.selectedId !== null) dispatchMeasure({ type: 'select', id: null });
      else if (measure.mode !== 'off') dispatchMeasure({ type: 'setMode', mode: 'off' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, measure.draft.phase, measure.selectedId, measure.mode]);

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
      void sampleBytes(sample).then((bytes) => {
        const files = [{ path: sample.fileName, file: new File([bytes], sample.fileName) }];
        // A sample with sidecars is dropped as the multi-file set it really is, so it goes
        // through exactly the same companion resolution a folder drop would.
        for (const [path, companion] of sample.companions?.() ?? []) {
          files.push({ path, file: new File([companion], path) });
        }
        open(files);
      });
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
          // As authored, not as rotated: see AssetStats.sourceSize.
          ['Dimensions', formatDims(model.stats.sourceSize, mpu)],
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
              {/*
                Back to the empty state, where the file picker and the samples live.
                Dropping a file over the viewer still replaces the model in place; this is
                for choosing one deliberately rather than by dragging.
              */}
              <button type="button" className="back-button" data-action="back" onClick={clear}>
                ← Open another model
              </button>
              <p className="filename" title={model.name}>
                {model.name}
              </p>
              <a className="about-link" href="#/about">
                About &amp; licences
              </a>
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

      {route === 'about' && <About onClose={closeHashRoute} />}
    </div>
  );
}
