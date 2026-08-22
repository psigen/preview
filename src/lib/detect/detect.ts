import type { FormatId } from '../format-id';
import type { Probe } from './probe';

/**
 * How confident a single sniffer is.
 *  strong — a magic number or an unambiguous header. Trustworthy even if the name lies.
 *  weak   — a plausible textual shape. Needs the extension to agree, or a fallthrough attempt.
 */
export type SniffResult = 'no' | 'weak' | 'strong';

/** Why the returned candidate list is ordered the way it is. */
export type Confidence = 'hint' | 'strong' | 'extension' | 'weak' | 'none';

export interface Detection {
  /** Ordered best-first. The loader tries each in turn and falls through on a throw. */
  readonly candidates: FormatId[];
  readonly confidence: Confidence;
}

export interface Sniffer {
  readonly id: FormatId;
  readonly label: string;
  /** Lower-cased, dot-prefixed. */
  readonly extensions: readonly string[];
  /** Breaks ties between two equally strong sniffs. Higher wins. Default 0. */
  readonly priority?: number;
  sniff(p: Probe): SniffResult;
}

/* ------------------------------------------------------------------ helpers */

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const USDC_MAGIC = [0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43]; // 'PXR-USDC'
const FBX_BINARY_MAGIC = 'Kaydara FBX Binary  ';

function bytesAt(p: Probe, offset: number, expected: readonly number[]): boolean {
  if (p.head.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i++) if (p.head[offset + i] !== expected[i]) return false;
  return true;
}

function asciiAt(p: Probe, offset: number, expected: string): boolean {
  if (p.head.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (p.head[offset + i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

/** First non-empty line of the decoded head. */
function firstLine(p: Probe): string {
  const nl = p.text.indexOf('\n');
  return (nl === -1 ? p.text : p.text.slice(0, nl)).replace(/\r$/, '');
}

/* ----------------------------------------------------------------- sniffers */

export const SNIFFERS: readonly Sniffer[] = [
  {
    id: 'gltf',
    label: 'glTF 2.0 / GLB',
    extensions: ['.gltf', '.glb'],
    priority: 10,
    sniff(p) {
      // Binary container. Magic alone is decisive; a bad length still routes here so the
      // glTF plugin can report a truncated file instead of "unrecognised format".
      if (p.view.byteLength >= 12 && p.view.getUint32(0, true) === GLB_MAGIC) {
        const versionOk = p.view.getUint32(4, true) === 2;
        const lengthOk = p.view.getUint32(8, true) === p.size;
        return versionOk && lengthOk ? 'strong' : 'weak';
      }
      // JSON form.
      const t = p.text.trimStart();
      if (!t.startsWith('{')) return 'no';
      if (!/"asset"\s*:\s*\{/.test(t)) return 'no';
      return /"version"\s*:\s*"2\.\d+"/.test(t) ? 'strong' : 'weak';
    },
  },
  {
    id: 'ply',
    label: 'PLY (Stanford polygon)',
    extensions: ['.ply'],
    priority: 10,
    sniff(p) {
      if (!asciiAt(p, 0, 'ply')) return 'no';
      const b = p.head[3];
      if (b !== 0x0a && b !== 0x0d) return 'no';
      // The format line is mandatory and immediately follows the magic.
      return /^\s*format\s+(ascii|binary_little_endian|binary_big_endian)\s+1\.0/m.test(
        new TextDecoder().decode(p.head.subarray(0, Math.min(p.head.length, 256))),
      )
        ? 'strong'
        : 'weak';
    },
  },
  {
    id: 'stl',
    label: 'STL',
    extensions: ['.stl'],
    priority: 5,
    sniff(p) {
      // Length check first: 84 = 80-byte header + 4-byte triangle count. Many exporters write
      // a literal ASCII "solid ..." into a BINARY STL's header, so this must not be decided on
      // text. (In practice `p.text` is already empty for binary STL — see BINARY_SNIFF_BYTES in
      // probe.ts — but ordering it this way keeps us honest and matches three's own STLLoader.)
      if (p.size >= 84 && p.view.byteLength >= 84) {
        const n = p.view.getUint32(80, true);
        if (84 + n * 50 === p.size) return 'strong';
      }
      // ASCII form. three's own loader scans the first 5 bytes for 'solid' to tolerate BOMs.
      const t = p.text.trimStart();
      if (!t.startsWith('solid')) return 'no';
      return /facet\s+normal/.test(p.text) ? 'weak' : 'no';
    },
  },
  {
    id: 'obj',
    label: 'Wavefront OBJ',
    extensions: ['.obj'],
    sniff(p) {
      if (!p.text) return 'no';
      // An MTL library is not an OBJ, and shares no other distinguishing marker.
      if (/^\s*newmtl\s/m.test(p.text)) return 'no';
      if (!/^\s*v\s+[-+.\d]/m.test(p.text)) return 'no';
      return /^\s*f\s+/m.test(p.text) || /^\s*vn\s+/m.test(p.text) ? 'weak' : 'no';
    },
  },
  {
    id: 'usd',
    label: 'OpenUSD (usda / usdc / usdz)',
    extensions: ['.usd', '.usda', '.usdc', '.usdz'],
    priority: 10,
    sniff(p) {
      if (bytesAt(p, 0, USDC_MAGIC)) return 'strong'; // crate
      if (p.text.trimStart().startsWith('#usda')) return 'strong'; // ascii
      // usdz: a ZIP whose FIRST entry is the root layer (AOUSD 16.4.1.2).
      if (p.zipFirstEntry && /\.usd[ac]?$/i.test(p.zipFirstEntry)) return 'strong';
      return 'no';
    },
  },
  {
    id: '3mf',
    label: '3MF',
    extensions: ['.3mf'],
    priority: 10,
    sniff(p) {
      if (!p.zipFirstEntry) return 'no';
      if (p.zipFirstEntry === '[Content_Types].xml') return 'strong';
      // Some packagers reorder entries; fall back to spotting the model part by name.
      return p.text.includes('3D/3dmodel.model') ? 'weak' : 'no';
    },
  },
  {
    id: 'step',
    label: 'STEP (ISO 10303)',
    extensions: ['.step', '.stp'],
    priority: 10,
    sniff(p) {
      return p.text.trimStart().startsWith('ISO-10303-21;') ? 'strong' : 'no';
    },
  },
  {
    id: 'iges',
    label: 'IGES',
    extensions: ['.iges', '.igs'],
    sniff(p) {
      // 80-column fixed records with a section letter in column 73 (index 72).
      const line = firstLine(p);
      if (line.length < 73) return 'no';
      if (line[72] !== 'S') return 'no';
      return 'weak';
    },
  },
  {
    id: 'fbx',
    label: 'FBX',
    extensions: ['.fbx'],
    priority: 10,
    sniff(p) {
      if (asciiAt(p, 0, FBX_BINARY_MAGIC) && p.head[21] === 0x1a && p.head[22] === 0x00) {
        return 'strong';
      }
      return p.text.includes('FBXHeaderExtension') ? 'weak' : 'no';
    },
  },
  {
    id: 'brep',
    label: 'Open CASCADE BREP',
    extensions: ['.brep', '.brp'],
    sniff(p) {
      const t = p.text.trimStart();
      return t.startsWith('DBRep_DrawableShape') || t.startsWith('CASCADE Topology V')
        ? 'weak'
        : 'no';
    },
  },
];

const BY_ID = new Map(SNIFFERS.map((s) => [s.id, s]));

export function snifferFor(id: FormatId): Sniffer | undefined {
  return BY_ID.get(id);
}

/** Every extension the app will accept, for an <input accept="..."> attribute. */
export function acceptAttribute(): string {
  return SNIFFERS.flatMap((s) => s.extensions).sort().join(',');
}

export function formatsForExtension(ext: string): FormatId[] {
  const e = ext.toLowerCase();
  return SNIFFERS.filter((s) => s.extensions.includes(e)).map((s) => s.id);
}

/* ---------------------------------------------------------------- detection */

/**
 * Identify a file from its bytes, using the name only as a tie-breaker.
 *
 * Sniff-first rather than extension-first because people rename downloads, `.usd` may be
 * ASCII or crate, `.stl` may be ASCII or binary, and a `.zip` could be either container.
 *
 * Returns an ORDERED list. The caller tries each candidate and falls through on a parse
 * throw, which is the honest response to genuinely ambiguous input.
 */
export function detectFormat(p: Probe, hint?: FormatId): Detection {
  if (hint) return { candidates: [hint], confidence: 'hint' };

  const byExtension = new Set(formatsForExtension(p.ext));
  const strong: Sniffer[] = [];
  const weak: Sniffer[] = [];

  for (const s of SNIFFERS) {
    const r = s.sniff(p);
    if (r === 'strong') strong.push(s);
    else if (r === 'weak') weak.push(s);
  }

  // Extension agreement outranks priority: if two sniffers both say "strong", the one the
  // filename also claims is the better bet.
  const rank = (a: Sniffer, b: Sniffer) => {
    const ax = byExtension.has(a.id) ? 1 : 0;
    const bx = byExtension.has(b.id) ? 1 : 0;
    if (ax !== bx) return bx - ax;
    return (b.priority ?? 0) - (a.priority ?? 0);
  };

  if (strong.length) {
    strong.sort(rank);
    return { candidates: strong.map((s) => s.id), confidence: 'strong' };
  }

  weak.sort(rank);
  const weakIds = weak.map((s) => s.id);

  if (byExtension.size) {
    // Extension first, then any weak sniff it did not already cover.
    const ordered = [
      ...weakIds.filter((id) => byExtension.has(id)),
      ...[...byExtension].filter((id) => !weakIds.includes(id)),
      ...weakIds.filter((id) => !byExtension.has(id)),
    ];
    return { candidates: ordered, confidence: 'extension' };
  }

  if (weakIds.length) return { candidates: weakIds, confidence: 'weak' };
  return { candidates: [], confidence: 'none' };
}
