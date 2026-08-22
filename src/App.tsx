import { useMemo } from 'react';
import { loadStubModel } from './lib/load/stub';
import { formatDims, formatLength } from './lib/units';
import { computeBounds } from './lib/bounds';
import { assessModel } from './lib/limits';

/**
 * Scaffold. The viewer lands in the next stage; for now this renders a real slice of the
 * info panel from a stub model, which exercises the whole lib stack — buildScene, finalize,
 * stats, bounds and unit formatting — in a browser rather than only under Node.
 */
export function App() {
  const model = useMemo(() => loadStubModel(), []);
  const bounds = useMemo(() => computeBounds(model.object), [model]);
  const assessment = useMemo(
    () => assessModel(model.stats.triangles, model.stats.bytes),
    [model],
  );

  const mpu = model.units.known ? model.units.metersPerUnit : null;
  const diagonal = Math.hypot(...model.stats.size);

  const rows: [string, string][] = [
    ['Format', model.format.toUpperCase()],
    ['Meshes', String(model.stats.meshes)],
    ['Triangles', model.stats.triangles.toLocaleString('en-US')],
    ['Vertices', model.stats.vertices.toLocaleString('en-US')],
    ['Dimensions', formatDims(model.stats.size, mpu)],
    ['Diagonal', formatLength(diagonal, mpu).text],
    ['Radius', formatLength(bounds.sphere.radius, mpu).text],
    ['Up axis', `${model.sourceUpAxis} (source)`],
    [
      'Units',
      model.units.known
        ? `declared${model.units.sourceUnit ? ` — ${model.units.sourceUnit}` : ''}`
        : 'not declared',
    ],
  ];

  return (
    <div className="viewer-app">
      <div className="hud hud-top-left">
        <div className="panel-glass pad">
          <strong>preview</strong>
          <p className="hint">Scaffold — the 3D viewport lands in the next stage.</p>
        </div>
      </div>

      <div className="hud hud-right">
        <section className="panel-glass pad" aria-label="Model information">
          <h2 className="panel-title">{model.name}</h2>
          <dl className="stat-list">
            {rows.map(([key, value]) => (
              <div className="stat-row" key={key}>
                <dt className="stat-key">{key}</dt>
                <dd className="stat-value">{value}</dd>
              </div>
            ))}
          </dl>
          {model.warnings.length > 0 && (
            <ul className="warning-list">
              {model.warnings.map((w) => (
                <li key={w.code} className={w.severity === 'error' ? 'error' : 'hint warn'}>
                  {w.message}
                </li>
              ))}
            </ul>
          )}
          {assessment.messages.map((m) => (
            <p className="hint warn" key={m}>
              {m}
            </p>
          ))}
        </section>
      </div>
    </div>
  );
}
