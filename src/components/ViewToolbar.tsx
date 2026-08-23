import type { ViewId } from '../lib/camera';
import type { ViewApi } from '../types';

interface Props {
  apiRef: React.RefObject<ViewApi | null>;
  activeView: ViewId | null;
}

const VIEWS: ReadonlyArray<{ id: ViewId; label: string; key: string }> = [
  { id: 'front', label: 'Front', key: '1' },
  { id: 'back', label: 'Back', key: '2' },
  { id: 'right', label: 'Right', key: '3' },
  { id: 'left', label: 'Left', key: '4' },
  { id: 'top', label: 'Top', key: '5' },
  { id: 'bottom', label: 'Bottom', key: '6' },
  { id: 'iso', label: 'Iso', key: '7' },
];

/**
 * Standard views plus Fit.
 *
 * `aria-pressed` reflects where the camera actually is, computed by matchView from the live
 * orbit direction — not a record of which button was last clicked. Orbit away from Top by
 * more than a degree and Top stops being pressed, which is the honest state.
 */
export function ViewToolbar({ apiRef, activeView }: Props) {
  return (
    <div className="panel-glass view-toolbar">
      <div className="seg vertical" role="group" aria-label="Standard views">
        {VIEWS.map(({ id, label, key }) => (
          <button
            key={id}
            type="button"
            data-view={id}
            aria-pressed={activeView === id}
            title={`${label} view (${key})`}
            onClick={() => apiRef.current?.applyView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        data-view="fit"
        className="fit-button"
        title="Fit model to view (F)"
        onClick={() => apiRef.current?.fit()}
      >
        Fit
      </button>
    </div>
  );
}
