import { firstZipEntryName, isZip } from './zip';

/** How many leading bytes a sniffer may look at. */
export const PROBE_BYTES = 8192;

/**
 * A cheap, reusable view over the head of a file. Built once and handed to every sniffer, so
 * detection never re-decodes or re-slices. Pure data — no I/O, no three, no DOM.
 */
export interface Probe {
  /** First min(size, PROBE_BYTES) bytes. */
  readonly head: Uint8Array;
  /** A DataView over `head`. */
  readonly view: DataView;
  /** Total byte length of the whole file, not just the head. */
  readonly size: number;
  /** UTF-8 decode of `head`, BOM-stripped. Empty string when the head looks binary. */
  readonly text: string;
  /** Lower-cased extension including the dot, e.g. '.stl'. Empty when there is none. */
  readonly ext: string;
  /** Lower-cased basename. */
  readonly name: string;
  /** First ZIP entry name, or null when this is not a ZIP with a local header. */
  readonly zipFirstEntry: string | null;
}

const BOM = '﻿';

/**
 * How far in to look for a NUL before declaring the head binary.
 *
 * Must stay >= 84. A binary STL's triangle-count field sits at offsets 80..83, and for any
 * count below 16,843,009 (an 842 MB file) at least one of those bytes is zero. That is what
 * guarantees a binary STL never decodes to text, and therefore that its "solid ..." header —
 * which many exporters really do write — can never be mistaken for an ASCII STL. Shrinking
 * this window below 84 would silently re-open that trap.
 */
export const BINARY_SNIFF_BYTES = 512;

/** A NUL in the first stretch of a file means binary; decoding it as text is meaningless. */
function looksTextual(head: Uint8Array): boolean {
  const n = Math.min(head.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < n; i++) if (head[i] === 0) return false;
  return true;
}

export function basenameOf(name: string): string {
  return (name.toLowerCase().split(/[\\/]/).pop() ?? '').trim();
}

export function extensionOf(name: string): string {
  const base = basenameOf(name);
  const dot = base.lastIndexOf('.');
  // dot > 0, not >= 0: a leading dot makes a dotfile, not an extension.
  return dot > 0 ? base.slice(dot) : '';
}

export function makeProbe(name: string, bytes: ArrayBuffer | Uint8Array): Probe {
  const all = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = all.subarray(0, Math.min(all.length, PROBE_BYTES));
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);

  let text = '';
  if (looksTextual(head)) {
    text = new TextDecoder('utf-8', { fatal: false }).decode(head);
    if (text.startsWith(BOM)) text = text.slice(BOM.length);
  }

  return {
    head,
    view,
    size: all.length,
    text,
    ext: extensionOf(name),
    name: basenameOf(name),
    zipFirstEntry: isZip(view) ? firstZipEntryName(head, view) : null,
  };
}
