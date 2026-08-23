import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from './components/Viewer';
import { ViewToolbar } from './components/ViewToolbar';
import { computeBounds } from './lib/bounds';
import { assessModel } from './lib/limits';
import type { ViewId } from './lib/camera';
import { loadAsset, singleFileInput } from './lib/load/loadAsset';
import { SAMPLES, sampleById } from './lib/samples';
import type { LoadedModel } from './lib/asset/types';
import { formatDims, formatLength } from './lib/units';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';
import type { ViewApi } from './types';

export function App() {
  const [sampleId, setSampleId] = useState<string>(SAMPLES[0]!.id);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [busy, setBusy] = useState<string | null>('Loading sample…');
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewId | null>(null);
  const apiRef = useRef<ViewApi | null>(null);
  const reduceMotion = usePrefersReducedMotion();
  const currentRef = useRef<LoadedModel | null>(null);

  // Samples go through the ordinary loader — real STL and PLY bytes, detected and parsed
  // exactly as a dropped file would be — so this path is the one the tests cover.
  //
  // The effect sets no state synchronously: `busy` is seeded by useState for the first load
  // and set by the click handler for later ones, so switching sample costs one render
  // rather than a cascade. Only the async settlement writes state from here.
  useEffect(() => {
    let cancelled = false;
    const sample = sampleById(sampleId);

    loadAsset(singleFileInput(sample.fileName, sample.bytes()))
      .then((next) => {
        if (cancelled) {
          next.dispose();
          return;
        }
        // Dispose imperatively against a ref, never inside a setState updater: revoking a
        // URL is idempotent but geometry.dispose() is not, and StrictMode may run an
        // updater twice.
        const previous = currentRef.current;
        currentRef.current = next;
        setModel(next);
        if (previous) previous.dispose();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(`${message} Try another sample.`);
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });

    return () => {
      cancelled = true;
    };
  }, [sampleId]);

  const bounds = useMemo(() => (model ? computeBounds(model.object) : null), [model]);
  const assessment = useMemo(
    () => (model ? assessModel(model.stats.triangles, model.stats.bytes) : null),
    [model],
  );
  const mpu = model?.units.known ? model.units.metersPerUnit : null;
  const diagonal = model ? Math.hypot(...model.stats.size) : 0;

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const byKey: Record<string, ViewId> = {
        '1': 'front', '2': 'back', '3': 'right', '4': 'left',
        '5': 'top', '6': 'bottom', '7': 'iso',
      };
      const view = byKey[event.key];
      if (view) {
        event.preventDefault();
        apiRef.current?.applyView(view);
      } else if (event.key === 'f' || event.key === 'F' || event.key === 'Home') {
        event.preventDefault();
        apiRef.current?.fit();
      }
    },
    [],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  const rows: [string, string][] =
    model && bounds
      ? [
          ['Format', model.format.toUpperCase()],
          ['Triangles', model.stats.triangles.toLocaleString('en-US')],
          ['Points', model.stats.points.toLocaleString('en-US')],
          ['Dimensions', formatDims(model.stats.size, mpu)],
          ['Diagonal', formatLength(diagonal, mpu).text],
          ['Radius', formatLength(bounds.sphere.radius, mpu).text],
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
        />
      )}

      <div className="hud hud-top-left">
        <div className="panel-glass pad">
          <strong>preview</strong>
          <p className="hint">Bundled samples — drag-and-drop lands in a later stage.</p>
          <div className="seg sample-picker" role="group" aria-label="Sample model">
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                type="button"
                data-sample={s.id}
                aria-pressed={sampleId === s.id}
                title={s.label}
                onClick={() => {
                  if (s.id === sampleId) return;
                  setBusy(`Loading ${s.fileName}…`);
                  setError(null);
                  setSampleId(s.id);
                }}
              >
                {s.id}
              </button>
            ))}
          </div>
          {busy && (
            <p className="hint" role="status" aria-live="polite">
              {busy}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="hud hud-left">
        <ViewToolbar apiRef={apiRef} activeView={activeView} />
      </div>

      <div className="hud hud-right">
        <section className="panel-glass pad" aria-label="Model information">
          <h2 className="panel-title">{model?.name ?? '—'}</h2>
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
          {model && model.warnings.length > 0 && (
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
    </div>
  );
}
