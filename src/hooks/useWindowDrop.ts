import { useEffect, useRef, useState } from 'react';
import { hasFiles, type DroppedFile } from '../lib/dnd';
import { createDragTracker, STALE_DRAG_MS } from '../lib/dragTracker';
import { entriesFromDataTransfer, filesFromList, readEntries } from '../lib/dropEntries';

export interface WindowDropOptions {
  onFiles(files: DroppedFile[], truncated: boolean): void;
  /** Stops a second drop landing mid-load; the overlay is suppressed too. */
  disabled?: boolean;
}

/**
 * Window-wide drag and drop.
 *
 * Window-wide rather than a dropzone element, because the canvas fills the viewport: an
 * element-scoped target would either cover the whole viewer or stop existing once a model
 * is open. Replacing a model is then just dropping another file, with no round trip through
 * an empty state.
 */
export function useWindowDrop({ onFiles, disabled = false }: WindowDropOptions): boolean {
  const [dragging, setDragging] = useState(false);
  /**
   * A params ref, so the DOM listeners bind exactly once and never rebind mid-drag —
   * rebinding while a drag is in flight loses the enter/leave counter and strands the
   * overlay.
   *
   * Updated in an effect rather than during render: writing a ref during render is unsafe
   * under concurrent rendering, and the listeners only fire after paint, so a value one
   * commit old is not reachable.
   */
  const params = useRef({ onFiles, disabled });
  useEffect(() => {
    params.current = { onFiles, disabled };
  });

  useEffect(() => {
    const tracker = createDragTracker();
    const sync = () => setDragging(tracker.active);

    /**
     * Bound UNCONDITIONALLY, even while disabled, and on document rather than window.
     * Without a preventDefault on both dragover and drop, the browser NAVIGATES to the
     * dropped file — the loaded model is gone and there is no way back. That must never
     * depend on our own state being right.
     */
    const swallow = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDragEnter = (e: DragEvent) => {
      swallow(e);
      if (params.current.disabled) return;
      tracker.enter(hasFiles(e.dataTransfer), performance.now());
      sync();
    };

    const onDragOver = (e: DragEvent) => {
      swallow(e);
      if (params.current.disabled) return;
      tracker.over(hasFiles(e.dataTransfer), performance.now());
      sync();
    };

    const onDragLeave = () => {
      tracker.leave(performance.now());
      sync();
    };

    const onDrop = (e: DragEvent) => {
      swallow(e);
      tracker.end();
      sync();
      if (params.current.disabled || !e.dataTransfer) return;

      // Collect entries SYNCHRONOUSLY: the items list is emptied the moment this handler
      // returns, so anything read after an await comes back null.
      const entries = entriesFromDataTransfer(e.dataTransfer);
      const flat = filesFromList(e.dataTransfer.files ?? []);

      if (entries.length === 0) {
        if (flat.length) params.current.onFiles(flat, false);
        return;
      }
      void readEntries(entries).then(({ files, truncated }) => {
        // Fall back to the flat list if the entry walk yielded nothing usable.
        params.current.onFiles(files.length ? files : flat, truncated);
      });
    };

    const onDragEnd = () => {
      tracker.end();
      sync();
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    document.addEventListener('dragend', onDragEnd);
    // A drag that leaves via the window edge, or an alt-tab mid-drag, produces no dragleave.
    window.addEventListener('blur', onDragEnd);

    // The watchdog only runs while a drag is in flight, so an idle page polls nothing.
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = setInterval(() => {
      if (!tracker.active) return;
      if (tracker.tick(performance.now())) sync();
    }, STALE_DRAG_MS / 2);
    timer = poll;

    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('dragend', onDragEnd);
      window.removeEventListener('blur', onDragEnd);
      if (timer) clearInterval(timer);
    };
  }, []);

  return dragging && !disabled;
}
