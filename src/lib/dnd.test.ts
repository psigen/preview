import { describe, expect, it } from 'vitest';
import { createDragTracker, STALE_DRAG_MS } from './dragTracker';
import { hasFiles, normalizePath, selectPrimary, stripCommonRoot, type DroppedFile } from './dnd';

const dropped = (path: string): DroppedFile => ({ path, file: new File([], path) });

describe('createDragTracker', () => {
  it('activates on a file drag and deactivates on the matching leave', () => {
    const t = createDragTracker();
    expect(t.active).toBe(false);
    t.enter(true, 0);
    expect(t.active).toBe(true);
    t.leave(10);
    expect(t.active).toBe(false);
  });

  /** The flicker bug: enter/leave fire for every child element the pointer crosses. */
  it('stays active while crossing nested elements', () => {
    const t = createDragTracker();
    t.enter(true, 0); // window
    t.enter(true, 10); // a panel
    t.leave(20); // leaving the window edge of that panel
    expect(t.active).toBe(true);
    t.enter(true, 30); // another child
    t.leave(40);
    expect(t.active).toBe(true);
    t.leave(50);
    expect(t.active).toBe(false);
  });

  it('ignores a drag carrying no files, so dragging text shows nothing', () => {
    const t = createDragTracker();
    t.enter(false, 0);
    t.over(false, 10);
    expect(t.active).toBe(false);
    expect(t.depth).toBe(0);
  });

  it('never counts below zero when a stray leave arrives first', () => {
    const t = createDragTracker();
    t.leave(0);
    t.leave(10);
    expect(t.depth).toBe(0);
    t.enter(true, 20);
    t.leave(30);
    expect(t.active).toBe(false);
  });

  /** The leak: a dragleave is swallowed when the pointer exits past the window edge. */
  it('force-clears a stale drag whose leave never arrived', () => {
    const t = createDragTracker();
    t.enter(true, 0);
    t.over(true, 100);
    expect(t.tick(100 + STALE_DRAG_MS)).toBe(false); // still fresh, exactly on the boundary
    expect(t.active).toBe(true);
    expect(t.tick(100 + STALE_DRAG_MS + 1)).toBe(true); // stale: force-cleared
    expect(t.active).toBe(false);
    expect(t.depth).toBe(0);
  });

  it('does not report a force-clear when nothing was active', () => {
    const t = createDragTracker();
    expect(t.tick(10_000)).toBe(false);
  });

  it('keeps a slow but live drag active indefinitely', () => {
    const t = createDragTracker();
    t.enter(true, 0);
    for (let now = 0; now < 10_000; now += 50) {
      t.over(true, now);
      expect(t.tick(now)).toBe(false);
    }
    expect(t.active).toBe(true);
  });

  /** A drag can begin before the listeners attach, or have its dragenter swallowed. */
  it('recovers from a missed dragenter, because dragover keeps firing', () => {
    const t = createDragTracker();
    t.over(true, 0);
    expect(t.active).toBe(true);
    t.leave(10);
    expect(t.active).toBe(false);
  });

  it('end() clears unconditionally, however deep the counter got', () => {
    const t = createDragTracker();
    t.enter(true, 0);
    t.enter(true, 1);
    t.enter(true, 2);
    t.end();
    expect(t.active).toBe(false);
    expect(t.depth).toBe(0);
  });
});

describe('hasFiles', () => {
  it('detects a file drag', () => {
    expect(hasFiles({ types: ['Files'] } as unknown as DataTransfer)).toBe(true);
    expect(hasFiles({ types: ['text/plain', 'Files'] } as unknown as DataTransfer)).toBe(true);
  });

  it('rejects text and link drags, and a missing dataTransfer', () => {
    expect(hasFiles({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
    expect(hasFiles({ types: [] } as unknown as DataTransfer)).toBe(false);
    expect(hasFiles(null)).toBe(false);
    expect(hasFiles(undefined)).toBe(false);
  });
});

describe('normalizePath', () => {
  it.each([
    ['./model.gltf', 'model.gltf'],
    ['/abs/Model.GLTF', 'abs/model.gltf'],
    ['dir\\sub\\Part.STL', 'dir/sub/part.stl'],
    ['tex/my%20image.png', 'tex/my image.png'],
    ['  spaced.obj  ', 'spaced.obj'],
  ])('%s -> %s', (input, want) => {
    expect(normalizePath(input)).toBe(want);
  });

  it('keeps a literal percent that is not an escape', () => {
    expect(normalizePath('100%good.stl')).toBe('100%good.stl');
  });
});

describe('stripCommonRoot', () => {
  it('removes the wrapper directory a folder drop adds', () => {
    const paths = ['mymodel/scene.gltf', 'mymodel/scene.bin', 'mymodel/tex/a.png'];
    const strip = stripCommonRoot(paths);
    expect(paths.map(strip)).toEqual(['scene.gltf', 'scene.bin', 'tex/a.png']);
  });

  it('removes several shared levels', () => {
    const paths = ['a/b/scene.gltf', 'a/b/scene.bin'];
    expect(paths.map(stripCommonRoot(paths))).toEqual(['scene.gltf', 'scene.bin']);
  });

  it('leaves flat drops alone', () => {
    const paths = ['scene.gltf', 'scene.bin'];
    expect(paths.map(stripCommonRoot(paths))).toEqual(paths);
  });

  it('does not strip when the directories differ', () => {
    const paths = ['a/scene.gltf', 'b/scene.bin'];
    expect(paths.map(stripCommonRoot(paths))).toEqual(paths);
  });

  /** Stripping the last segment would leave a file with no name at all. */
  it('never consumes the filename', () => {
    const paths = ['only/one.stl'];
    expect(paths.map(stripCommonRoot(paths))).toEqual(['one.stl']);
    expect(stripCommonRoot(['solo.stl'])('solo.stl')).toBe('solo.stl');
  });

  it('handles an empty drop', () => {
    expect(stripCommonRoot([])('x')).toBe('x');
  });
});

describe('selectPrimary', () => {
  it('returns nothing loadable for a drop with no recognised extension', () => {
    const s = selectPrimary([dropped('readme.txt'), dropped('notes.md')]);
    expect(s.primary).toBeNull();
    expect(s.alternatives).toEqual([]);
    expect(s.companions.size).toBe(2);
  });

  it('picks the only loadable file and files the rest as companions', () => {
    const s = selectPrimary([dropped('model.obj'), dropped('model.mtl'), dropped('tex/a.png')]);
    expect(s.primary?.path).toBe('model.obj');
    expect([...s.companions.keys()].sort()).toEqual(['model.mtl', 'tex/a.png']);
  });

  it('prefers a scene format over a bare mesh', () => {
    // A converted export usually ships both; the glTF is the richer one.
    expect(selectPrimary([dropped('part.stl'), dropped('part.gltf')]).primary?.path).toBe('part.gltf');
  });

  it('prefers the shallowest candidate when ranks tie', () => {
    const s = selectPrimary([dropped('backup/old/scene.gltf'), dropped('scene.gltf')]);
    expect(s.primary?.path).toBe('scene.gltf');
  });

  it('is deterministic for equally-placed candidates', () => {
    const files = [dropped('b.stl'), dropped('a.stl')];
    expect(selectPrimary(files).primary?.path).toBe('a.stl');
    expect(selectPrimary([...files].reverse()).primary?.path).toBe('a.stl');
  });

  it('offers the losers as alternatives without duplicating the primary', () => {
    const s = selectPrimary([dropped('a.stl'), dropped('b.ply'), dropped('c.step')]);
    expect(s.primary?.path).toBe('a.stl');
    expect(s.alternatives.map((f) => f.path)).toEqual(['b.ply', 'c.step']);
    expect(s.companions.has('a.stl')).toBe(false);
  });
});
