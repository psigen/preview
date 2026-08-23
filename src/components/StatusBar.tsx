import type { PendingLarge } from '../hooks/useModelLoader';

interface Props {
  busy: string | null;
  error: string | null;
  pendingLarge: PendingLarge | null;
  onDismissError(): void;
}

/**
 * Progress, errors, and the one confirmation this app asks for.
 *
 * `role="status"` for progress and `role="alert"` for errors, which videoclip lacks
 * entirely — a screen reader otherwise gets no signal that anything happened.
 *
 * There is no <progress> element: most of what happens here is phase-based rather than
 * fractional (OCCT exposes no progress callback at all), and a bar that jumps between two
 * arbitrary positions is worse than a clear label.
 */
export function StatusBar({ busy, error, pendingLarge, onDismissError }: Props) {
  if (!busy && !error && !pendingLarge) return null;

  return (
    <div className="panel-glass status-bar">
      {busy && (
        <p className="status-line" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          {busy}
        </p>
      )}

      {pendingLarge && (
        <div className="status-confirm" role="alertdialog" aria-label="Large file">
          <p className="hint warn">{pendingLarge.message}</p>
          <div className="empty-actions">
            <button type="button" className="secondary" onClick={pendingLarge.confirm}>
              Load anyway
            </button>
            <button type="button" onClick={pendingLarge.cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="error status-line" role="alert">
          {error}
          <button type="button" className="link" onClick={onDismissError} aria-label="Dismiss error">
            ✕
          </button>
        </p>
      )}
    </div>
  );
}
