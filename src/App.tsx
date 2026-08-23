import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from './components/Viewer';
import { ViewToolbar } from './components/ViewToolbar';
import { computeBounds } from './lib/bounds';
import type { ViewId } from './lib/camera';
import { loadStubModel } from './lib/load/stub';
import type { LoadedModel } from './lib/asset/types';
import { formatDims, formatLength } from './lib/units';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';
import type { ViewApi } from './types';

/**
 * Placeholder models, until real file loading lands.
 *
 * All three share the same 1:2:3 proportions but differ in world scale by seven orders of
 * magnitude. Because the camera derives every constant from the bounding-sphere radius and
 * never rescales the model, all three must frame identically — which is exactly what the
 * scale-invariance check asserts.
 */
const SAMPLES = [
  { id: 'mm', label: '10 mm part, authored in mm', extents: [10, 20, 30] as const, metersPerUnit: 0.001 },
  { id: 'm', label: '10 mm part, authored in m', extents: [0.01, 0.02, 0.03] as const, metersPerUnit: 1 },
  { id: 'big', label: '100 m scene, authored in m', extents: [100, 200, 300] as const, metersPerUnit: 1 },
] as const;

export function App() {
  const [sampleId, setSampleId] = useState<(typeof SAMPLES)[number]['id']>('mm');
  const [activeView, setActiveView] = useState<ViewId | null>(null);
  const apiRef = useRef<ViewApi | null>(null);
  const reduceMotion = usePrefersReducedMotion();
  const currentRef = useRef<LoadedModel | null>(null);

  const model = useMemo(() => {
    const sample = SAMPLES.find((s) => s.id === sampleId) ?? SAMPLES[0];
    return loadStubModel({
      extents: [...sample.extents] as [number, number, number],
      metersPerUnit: sample.metersPerUnit,
    });
  }, [sampleId]);

  // Dispose imperatively against a ref rather than inside a setState updater: revoking a URL
  // is idempotent but geometry.dispose() is not, and StrictMode may run an updater twice.
  useEffect(() => {
    const previous = currentRef.current;
    currentRef.current = model;
    if (previous && previous !== model) previous.dispose();
  }, [model]);

  const bounds = useMemo(() => computeBounds(model.object), [model]);
  const mpu = model.units.known ? model.units.metersPerUnit : null;
  const diagonal = Math.hypot(...model.stats.size);

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

  const rows: [string, string][] = [
    ['Format', model.format.toUpperCase()],
    ['Triangles', model.stats.triangles.toLocaleString('en-US')],
    ['Dimensions', formatDims(model.stats.size, mpu)],
    ['Diagonal', formatLength(diagonal, mpu).text],
    ['Radius', formatLength(bounds.sphere.radius, mpu).text],
    ['Units', model.units.known ? 'declared' : 'not declared'],
  ];

  return (
    <div className="viewer-app">
      <Viewer
        model={model}
        bounds={bounds}
        apiRef={apiRef}
        onActiveViewChange={setActiveView}
        reduceMotion={reduceMotion}
      />

      <div className="hud hud-top-left">
        <div className="panel-glass pad">
          <strong>preview</strong>
          <p className="hint">Placeholder models — file loading lands in a later stage.</p>
          <div className="seg sample-picker" role="group" aria-label="Placeholder model">
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                type="button"
                data-sample={s.id}
                aria-pressed={sampleId === s.id}
                title={s.label}
                onClick={() => setSampleId(s.id)}
              >
                {s.id}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="hud hud-left">
        <ViewToolbar apiRef={apiRef} activeView={activeView} />
      </div>

      <div className="hud hud-right">
        <section className="panel-glass pad" aria-label="Model information">
          <h2 className="panel-title">{model.name}</h2>
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
        </section>
      </div>
    </div>
  );
}
