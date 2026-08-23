/**
 * The state machine behind a window-wide drop target.
 *
 * Window-wide drag-and-drop is where this pattern usually breaks, and the reason is that
 * `dragleave` is not reliable: it is swallowed when the pointer exits past the window edge,
 * and again when the element under the cursor is removed mid-drag. A naive
 * enter/leave boolean then latches on and the overlay never goes away.
 *
 * Two mechanisms together fix it:
 *
 *  1. A DEPTH COUNTER rather than a boolean. `dragenter` and `dragleave` both fire as the
 *     pointer crosses every child element, so counting them is what stops the overlay
 *     flickering on and off as the cursor moves across the page.
 *
 *  2. A WATCHDOG on `dragover`, which fires continuously (every few tens of milliseconds)
 *     for as long as a drag is over the window. If the last one was too long ago, the drag
 *     is gone whatever the counter believes, and the overlay is force-cleared.
 *
 * Kept as a pure state machine with time injected, so all of that is testable in plain Node
 * without a DOM, fake timers, or a synthetic DragEvent.
 */

/** A drag is considered gone if no `dragover` arrived within this many milliseconds. */
export const STALE_DRAG_MS = 300;

export interface DragTracker {
  /** True while the overlay should be shown. */
  readonly active: boolean;
  /** @param carriesFiles false for a text or link drag, which must not show the overlay. */
  enter(carriesFiles: boolean, now: number): void;
  leave(now: number): void;
  over(carriesFiles: boolean, now: number): void;
  /** Drop, dragend, or the window losing focus: unconditionally over. */
  end(): void;
  /** Watchdog poll. Returns true if it had to force-clear a stale drag. */
  tick(now: number): boolean;
  /** Test seam. */
  readonly depth: number;
}

export function createDragTracker(staleMs: number = STALE_DRAG_MS): DragTracker {
  let depth = 0;
  let lastOverAt = 0;
  let active = false;

  const clear = () => {
    depth = 0;
    active = false;
  };

  return {
    get active() {
      return active;
    },
    get depth() {
      return depth;
    },

    enter(carriesFiles, now) {
      // Ignore a drag with no files entirely: dragging selected text across the page must
      // not flash a "drop your model here" overlay.
      if (!carriesFiles) return;
      depth += 1;
      lastOverAt = now;
      active = true;
    },

    leave(now) {
      if (depth === 0) return;
      depth -= 1;
      lastOverAt = now;
      if (depth === 0) active = false;
    },

    over(carriesFiles, now) {
      if (!carriesFiles) return;
      lastOverAt = now;
      // A drag that entered before we were listening, or whose dragenter was swallowed,
      // still produces dragover. Treat that as authoritative rather than missing the drag.
      if (depth === 0) depth = 1;
      active = true;
    },

    end() {
      clear();
    },

    tick(now) {
      if (!active) return false;
      if (now - lastOverAt <= staleMs) return false;
      clear();
      return true;
    },
  };
}
