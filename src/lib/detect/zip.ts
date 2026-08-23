/**
 * Read the first entry name out of a ZIP local file header, without inflating anything.
 *
 * USDZ and 3MF are both ZIP containers, so the extension is useless and the magic bytes are
 * identical. One read of the header at offset 0 separates them: USDZ requires its root layer
 * to be the first entry (AOUSD 16.4.1.2), and 3MF packages lead with `[Content_Types].xml`.
 *
 * Layout of a local file header:
 *   0  signature 'PK\x03\x04'
 *  26  uint16LE  file name length
 *  28  uint16LE  extra field length
 *  30  file name bytes
 */
const ZIP_LOCAL_HEADER = 0x04034b50;
/** Empty archive ('PK\x05\x06') and spanned archive ('PK\x07\x08') — valid ZIPs, no first entry. */
const ZIP_END_OF_CENTRAL_DIR = 0x06054b50;
const ZIP_SPANNED = 0x08074b50;

function zipSignature(view: DataView): number | null {
  if (view.byteLength < 4) return null;
  const sig = view.getUint32(0, true);
  return sig === ZIP_LOCAL_HEADER || sig === ZIP_END_OF_CENTRAL_DIR || sig === ZIP_SPANNED
    ? sig
    : null;
}

export function isZip(view: DataView): boolean {
  return zipSignature(view) !== null;
}

export function firstZipEntryName(head: Uint8Array, view: DataView): string | null {
  if (view.byteLength < 30) return null;
  if (view.getUint32(0, true) !== ZIP_LOCAL_HEADER) return null;
  const nameLen = view.getUint16(26, true);
  if (nameLen === 0 || 30 + nameLen > head.length) return null;
  // ZIP names are IBM437 or UTF-8; both agree on the ASCII we care about here.
  return new TextDecoder('utf-8', { fatal: false }).decode(head.subarray(30, 30 + nameLen));
}
