/**
 * jsdom coverage for the DOM wiring of the window-wide drop target.
 *
 * The state machine itself is pure and tested in src/lib/dnd.test.ts. What can only be
 * checked here is the wiring: that preventDefault is called (without it the browser
 * navigates away from the app), that entries are read from the event, and that the watchdog
 * interval actually runs.
 *
 * jsdom implements neither DataTransfer nor DragEvent, so both are faked — which is fine,
 * because the hook only ever reads `types`, `items` and `files` and writes `dropEffect`.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DroppedFile } from '../lib/dnd';
import { useWindowDrop } from './useWindowDrop';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Harness {
  readonly dragging: () => boolean;
  unmount(): void;
}

let container: HTMLDivElement;
let root: Root;

function render(
  onFiles: (f: DroppedFile[], truncated: boolean) => void,
  disabled = false,
): Harness {
  let latest = false;
  function Probe() {
    latest = useWindowDrop({ onFiles, disabled });
    return null;
  }
  act(() => {
    root.render(<Probe />);
  });
  return {
    dragging: () => latest,
    unmount: () => act(() => root.unmount()),
  };
}

/** A DataTransfer stand-in carrying the three fields the hook reads. */
function fakeTransfer(files: File[] = [], types?: string[]) {
  return {
    types: types ?? (files.length ? ['Files'] : ['text/plain']),
    items: files.map((f) => ({ kind: 'file', getAsFile: () => f })),
    files,
    dropEffect: 'none',
  };
}

function fire(type: string, transfer: ReturnType<typeof fakeTransfer>) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  vi.useRealTimers();
  container.remove();
});

describe('useWindowDrop', () => {
  it('shows nothing until a file drag arrives', () => {
    const h = render(() => {});
    expect(h.dragging()).toBe(false);
    h.unmount();
  });

  it('activates on a file dragenter and clears on the matching dragleave', () => {
    const h = render(() => {});
    fire('dragenter', fakeTransfer([new File([], 'a.stl')]));
    expect(h.dragging()).toBe(true);
    fire('dragleave', fakeTransfer([new File([], 'a.stl')]));
    expect(h.dragging()).toBe(false);
    h.unmount();
  });

  it('stays active across nested enters, which is the flicker case', () => {
    const h = render(() => {});
    const dt = fakeTransfer([new File([], 'a.stl')]);
    fire('dragenter', dt);
    fire('dragenter', dt);
    fire('dragleave', dt);
    expect(h.dragging()).toBe(true);
    fire('dragleave', dt);
    expect(h.dragging()).toBe(false);
    h.unmount();
  });

  it('ignores a text drag', () => {
    const h = render(() => {});
    fire('dragenter', fakeTransfer([], ['text/plain']));
    expect(h.dragging()).toBe(false);
    h.unmount();
  });

  /**
   * The one that matters most: without preventDefault on BOTH dragover and drop, the browser
   * navigates to the dropped file and the open model is gone with no way back.
   */
  it('calls preventDefault on dragover and drop', () => {
    const h = render(() => {});
    const dt = fakeTransfer([new File([], 'a.stl')]);
    expect(fire('dragover', dt).defaultPrevented).toBe(true);
    expect(fire('drop', dt).defaultPrevented).toBe(true);
    h.unmount();
  });

  it('still prevents navigation while disabled', () => {
    // Suppressing our own handling must never re-enable the browser's.
    const onFiles = vi.fn();
    const h = render(onFiles, true);
    const dt = fakeTransfer([new File([], 'a.stl')]);
    expect(fire('dragover', dt).defaultPrevented).toBe(true);
    expect(fire('drop', dt).defaultPrevented).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
    expect(h.dragging()).toBe(false);
    h.unmount();
  });

  it('sets dropEffect so the cursor shows a copy', () => {
    const h = render(() => {});
    const dt = fakeTransfer([new File([], 'a.stl')]);
    fire('dragover', dt);
    expect(dt.dropEffect).toBe('copy');
    h.unmount();
  });

  it('hands the dropped files to the callback and clears the overlay', () => {
    const onFiles = vi.fn();
    const h = render(onFiles);
    const file = new File(['x'], 'Part.STL');
    const dt = fakeTransfer([file]);
    fire('dragenter', dt);
    fire('drop', dt);
    expect(onFiles).toHaveBeenCalledTimes(1);
    const [files] = onFiles.mock.calls[0]!;
    expect(files.map((f: DroppedFile) => f.path)).toEqual(['part.stl']);
    expect(h.dragging()).toBe(false);
    h.unmount();
  });

  /** A drag leaving past the window edge sends no dragleave at all. */
  it('times a stale drag out via the watchdog', async () => {
    vi.useFakeTimers();
    const h = render(() => {});
    fire('dragenter', fakeTransfer([new File([], 'a.stl')]));
    expect(h.dragging()).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(h.dragging()).toBe(false);
    h.unmount();
  });

  it('detaches its listeners on unmount', () => {
    const onFiles = vi.fn();
    const h = render(onFiles);
    h.unmount();
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: fakeTransfer([new File([], 'a.stl')]) });
    document.dispatchEvent(event);
    expect(onFiles).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
