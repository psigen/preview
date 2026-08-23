/**
 * The visual half of the window-wide drop target.
 *
 * `pointer-events: none` is essential: the drop is handled by a document-level listener, so
 * this element must never intercept it. It is decoration, and a second real drop target is
 * how a drop gets handled twice.
 */
export function DropOverlay() {
  return (
    <div className="drop-overlay" role="presentation">
      <div className="drop-frame">
        <strong>Drop to open</strong>
        <span className="hint">A single file, several files, or a whole folder</span>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        Release to open the model
      </p>
    </div>
  );
}
