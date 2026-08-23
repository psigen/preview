import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READ_LIMITS,
  filesFromList,
  readEntries,
  type DirectoryReaderLike,
  type FileSystemEntryLike,
} from './dropEntries';

/** A fake file entry, matching the callback shape the real FileSystem API uses. */
const fileEntry = (fullPath: string): FileSystemEntryLike => ({
  isFile: true,
  isDirectory: false,
  fullPath,
  name: fullPath.split('/').pop()!,
  file: (ok) => ok(new File(['x'], fullPath.split('/').pop()!)),
});

/**
 * A fake directory that hands back its children in batches of `batchSize`, mimicking
 * Chrome's 100-entry cap on readEntries.
 */
const dirEntry = (
  fullPath: string,
  children: FileSystemEntryLike[],
  batchSize = 100,
): FileSystemEntryLike => ({
  isFile: false,
  isDirectory: true,
  fullPath,
  name: fullPath.split('/').pop()!,
  createReader(): DirectoryReaderLike {
    let cursor = 0;
    return {
      readEntries(ok) {
        const batch = children.slice(cursor, cursor + batchSize);
        cursor += batch.length;
        ok(batch);
      },
    };
  },
});

describe('readEntries', () => {
  it('reads a flat set of dropped files', async () => {
    const { files, truncated } = await readEntries([fileEntry('/a.stl'), fileEntry('/b.ply')]);
    expect(files.map((f) => f.path).sort()).toEqual(['a.stl', 'b.ply']);
    expect(truncated).toBe(false);
  });

  it('recurses into a dropped folder and strips its wrapper directory', async () => {
    const tree = dirEntry('/model', [
      fileEntry('/model/scene.gltf'),
      fileEntry('/model/scene.bin'),
      dirEntry('/model/tex', [fileEntry('/model/tex/albedo.png')]),
    ]);
    const { files } = await readEntries([tree]);
    expect(files.map((f) => f.path).sort()).toEqual(['scene.bin', 'scene.gltf', 'tex/albedo.png']);
  });

  /**
   * The truncation trap: Chrome's readEntries yields at most 100 entries per call, so a
   * single read silently loses everything past the first batch.
   */
  it('drains a directory that exceeds one readEntries batch', async () => {
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`/big/part${i}.stl`));
    const { files, truncated } = await readEntries([dirEntry('/big', many, 100)]);
    expect(files).toHaveLength(250);
    expect(truncated).toBe(false);
  });

  it('stops and reports truncation past the file limit', async () => {
    const many = Array.from({ length: 50 }, (_, i) => fileEntry(`/big/p${i}.stl`));
    const { files, truncated } = await readEntries([dirEntry('/big', many)], {
      ...DEFAULT_READ_LIMITS,
      maxFiles: 10,
    });
    expect(files.length).toBeLessThanOrEqual(10);
    expect(truncated).toBe(true);
  });

  it('stops and reports truncation past the depth limit', async () => {
    // a/b/c/deep.stl with maxDepth 2
    const deep = dirEntry('/a', [dirEntry('/a/b', [dirEntry('/a/b/c', [fileEntry('/a/b/c/deep.stl')])])]);
    const { files, truncated } = await readEntries([deep], { maxFiles: 100, maxDepth: 2 });
    expect(files).toHaveLength(0);
    expect(truncated).toBe(true);
  });

  it('skips an entry whose file() reports an error rather than failing the whole drop', async () => {
    const broken: FileSystemEntryLike = {
      isFile: true,
      isDirectory: false,
      fullPath: '/locked.stl',
      name: 'locked.stl',
      file: (_ok, err) => err?.(new Error('permission denied')),
    };
    const { files } = await readEntries([broken, fileEntry('/good.stl')]);
    expect(files.map((f) => f.path)).toEqual(['good.stl']);
  });

  it('tolerates a directory entry with no reader', async () => {
    const odd: FileSystemEntryLike = {
      isFile: false, isDirectory: true, fullPath: '/x', name: 'x',
    };
    await expect(readEntries([odd])).resolves.toEqual({ files: [], truncated: false });
  });

  it('handles an empty drop', async () => {
    await expect(readEntries([])).resolves.toEqual({ files: [], truncated: false });
  });
});

describe('filesFromList', () => {
  it('uses plain names for a flat file-input selection', () => {
    const files = filesFromList([new File([], 'Part.STL'), new File([], 'b.ply')]);
    expect(files.map((f) => f.path)).toEqual(['part.stl', 'b.ply']);
  });

  it('uses webkitRelativePath for a directory input and strips the wrapper', () => {
    const mk = (name: string, rel: string) => {
      const f = new File([], name);
      Object.defineProperty(f, 'webkitRelativePath', { value: rel });
      return f;
    };
    const files = filesFromList([
      mk('scene.gltf', 'model/scene.gltf'),
      mk('scene.bin', 'model/scene.bin'),
    ]);
    expect(files.map((f) => f.path).sort()).toEqual(['scene.bin', 'scene.gltf']);
  });
});
