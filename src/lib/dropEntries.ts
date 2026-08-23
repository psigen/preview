/**
 * Reading a drop into a flat file list, including dropped directories.
 *
 * Two traps here, both of which produce silently incomplete drops rather than errors:
 *
 *  1. `DataTransferItem.webkitGetAsEntry()` must be called SYNCHRONOUSLY, before any await.
 *     The items list is emptied as soon as the drop handler returns, so collecting entries
 *     lazily yields nulls for everything after the first await.
 *
 *  2. `DirectoryReader.readEntries()` returns at most 100 entries per call in Chrome. It
 *     must be called repeatedly until it yields an empty batch; reading once quietly
 *     truncates any folder with more than 100 files.
 *
 * The entry types are structural rather than lib.dom's, so the traversal is testable with
 * plain objects and needs no DOM.
 */
import { normalizePath, stripCommonRoot, type DroppedFile } from './dnd';

export interface FileSystemEntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly fullPath: string;
  readonly name: string;
  file?(onSuccess: (file: File) => void, onError?: (err: unknown) => void): void;
  createReader?(): DirectoryReaderLike;
}

export interface DirectoryReaderLike {
  readEntries(
    onSuccess: (entries: FileSystemEntryLike[]) => void,
    onError?: (err: unknown) => void,
  ): void;
}

export interface ReadLimits {
  /** Refuse pathological drops rather than hanging. */
  readonly maxFiles: number;
  readonly maxDepth: number;
}

export const DEFAULT_READ_LIMITS: ReadLimits = { maxFiles: 2000, maxDepth: 12 };

/** Collect the entries synchronously. MUST be called before the drop handler yields. */
export function entriesFromDataTransfer(dataTransfer: DataTransfer): FileSystemEntryLike[] {
  const out: FileSystemEntryLike[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = (item as unknown as {
      webkitGetAsEntry?: () => FileSystemEntryLike | null;
    }).webkitGetAsEntry?.();
    if (entry) out.push(entry);
  }
  return out;
}

const fileOf = (entry: FileSystemEntryLike): Promise<File | null> =>
  new Promise((resolve) => {
    if (!entry.file) {
      resolve(null);
      return;
    }
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    );
  });

/** Drain a directory reader completely; a single call caps out at 100 entries. */
const drain = (reader: DirectoryReaderLike): Promise<FileSystemEntryLike[]> =>
  new Promise((resolve) => {
    const all: FileSystemEntryLike[] = [];
    const next = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          next();
        },
        () => resolve(all),
      );
    };
    next();
  });

export interface ReadResult {
  readonly files: DroppedFile[];
  /** True when a limit stopped the walk, so the caller can say so rather than fail quietly. */
  readonly truncated: boolean;
}

export async function readEntries(
  entries: readonly FileSystemEntryLike[],
  limits: ReadLimits = DEFAULT_READ_LIMITS,
): Promise<ReadResult> {
  const collected: { path: string; file: File }[] = [];
  let truncated = false;

  const walk = async (entry: FileSystemEntryLike, depth: number): Promise<void> => {
    if (collected.length >= limits.maxFiles) {
      truncated = true;
      return;
    }
    if (entry.isFile) {
      const file = await fileOf(entry);
      if (file) collected.push({ path: normalizePath(entry.fullPath || entry.name), file });
      return;
    }
    if (!entry.isDirectory) return;
    if (depth >= limits.maxDepth) {
      truncated = true;
      return;
    }
    const reader = entry.createReader?.();
    if (!reader) return;
    for (const child of await drain(reader)) {
      await walk(child, depth + 1);
    }
  };

  for (const entry of entries) await walk(entry, 0);

  // A folder drop prefixes every path with the folder name, which the asset's own relative
  // references do not carry.
  const strip = stripCommonRoot(collected.map((c) => c.path));
  return {
    files: collected.map((c) => ({ path: strip(c.path), file: c.file })),
    truncated,
  };
}

/** Fallback for browsers or drags that expose only a flat FileList. */
export function filesFromList(list: ArrayLike<File>): DroppedFile[] {
  const raw = Array.from(list).map((file) => ({
    path: normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name),
    file,
  }));
  const strip = stripCommonRoot(raw.map((r) => r.path));
  return raw.map((r) => ({ path: strip(r.path), file: r.file }));
}
