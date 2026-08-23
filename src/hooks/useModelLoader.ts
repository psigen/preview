import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoadedModel } from '../lib/asset/types';
import { selectPrimary, type DroppedFile } from '../lib/dnd';
import { assessFileSize, LIMITS } from '../lib/limits';
import { loadAsset } from '../lib/load/loadAsset';
import type { AssetFile, LoadInput } from '../lib/registry/types';
import { acceptAttribute } from '../lib/detect/detect';

export interface PendingLarge {
  readonly message: string;
  confirm(): void;
  cancel(): void;
}

export interface ModelLoaderState {
  readonly model: LoadedModel | null;
  /** Non-null while loading; the string is the status to show. */
  readonly busy: string | null;
  readonly error: string | null;
  /** Set when a file is large enough that opening it might kill the tab. */
  readonly pendingLarge: PendingLarge | null;
  open(files: readonly DroppedFile[], truncated?: boolean): void;
  dismissError(): void;
}

/**
 * Owns the loaded model and its lifecycle.
 *
 * Disposal is imperative and driven by a ref, never done inside a setState updater:
 * revoking an object URL is idempotent but geometry.dispose() is not, and React may invoke
 * an updater twice under StrictMode. Without this, repeated loads leak GPU memory until the
 * tab dies — and "it gets slower the more models I open" is a bug that takes days to find.
 */
export function useModelLoader(): ModelLoaderState {
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingLarge, setPendingLarge] = useState<PendingLarge | null>(null);

  const currentRef = useRef<LoadedModel | null>(null);
  // Only the newest request may commit; an earlier slow load must not overwrite it.
  const requestRef = useRef(0);

  useEffect(
    () => () => {
      currentRef.current?.dispose();
      currentRef.current = null;
    },
    [],
  );

  const run = useCallback(async (
    primary: DroppedFile,
    siblings: ReadonlyMap<string, DroppedFile>,
    notice: string | null,
  ) => {
    const token = ++requestRef.current;
    setBusy(`Reading ${primary.file.name}…`);
    // `notice` survives the reset: a partial folder scan still loads, and the caveat is the
    // whole point. Clearing it here is what previously made that warning unreachable.
    setError(notice);
    setPendingLarge(null);

    try {
      const bytes = await primary.file.arrayBuffer();
      if (requestRef.current !== token) return;

      // Sidecars: a .gltf needs its .bin, an OBJ needs its .mtl, and both need textures.
      // Read up to a budget rather than unconditionally, because a dropped folder can carry
      // far more than the model itself.
      const companions = new Map<string, AssetFile>();
      let companionBytes = 0;
      let skipped = 0;
      for (const [path, sibling] of siblings) {
        if (companionBytes + sibling.file.size > LIMITS.companionBudgetBytes) {
          skipped += 1;
          continue;
        }
        companionBytes += sibling.file.size;
        companions.set(path, { name: path, path, bytes: await sibling.file.arrayBuffer() });
      }
      if (requestRef.current !== token) return;

      const input: LoadInput = {
        primary: { name: primary.path, path: primary.path, bytes },
        companions,
      };

      if (skipped > 0) {
        setError(`${skipped} companion file(s) were too large to read and were skipped.`);
      }

      const next = await loadAsset(input, {
        onProgress: (phase) => {
          if (requestRef.current === token) setBusy(`${phase}…`);
        },
      });

      if (requestRef.current !== token) {
        next.dispose();
        return;
      }

      const previous = currentRef.current;
      currentRef.current = next;
      setModel(next);
      if (previous) previous.dispose();
    } catch (err) {
      if (requestRef.current !== token) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(`${message} Supported files: ${acceptAttribute().replaceAll(',', ' ')}`);
    } finally {
      if (requestRef.current === token) setBusy(null);
    }
  }, []);

  const open = useCallback(
    (files: readonly DroppedFile[], truncated = false) => {
      const { primary, companions } = selectPrimary(files);

      if (!primary) {
        const names = files.slice(0, 3).map((f) => f.path).join(', ');
        setError(
          files.length === 0
            ? 'That drop contained no files.'
            : `Nothing in that drop can be opened${names ? ` (${names})` : ''}. ` +
              `Supported files: ${acceptAttribute().replaceAll(',', ' ')}`,
        );
        return;
      }

      const notice = truncated
        ? 'That folder was too large to read completely, so only part of it was scanned.'
        : null;

      // Check the size BEFORE reading a byte. Once a parse of a 500 MB mesh is under way
      // there is no recovery path — the tab simply dies — so this is the one place a
      // warning can still help.
      const { tooBig, message } = assessFileSize(primary.file.size);
      if (tooBig && message) {
        setPendingLarge({
          message,
          confirm: () => void run(primary, companions, notice),
          cancel: () => setPendingLarge(null),
        });
        return;
      }

      void run(primary, companions, notice);
    },
    [run],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { model, busy, error, pendingLarge, open, dismissError };
}
