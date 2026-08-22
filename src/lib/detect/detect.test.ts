import { describe, expect, it } from 'vitest';
import { zipSync } from 'three/addons/libs/fflate.module.js';
import { extentsIn } from '../../../test/gen/box';
import * as W from '../../../test/gen/writers';
import { FORMAT_IDS, type FormatId } from '../format-id';
import { makeProbe, extensionOf, basenameOf, BINARY_SNIFF_BYTES } from './probe';
import { firstZipEntryName, isZip, zipSignature } from './zip';
import { detectFormat, SNIFFERS, acceptAttribute, formatsForExtension } from './detect';

const mm = extentsIn('millimeter');
const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s).buffer as ArrayBuffer;
const detect = (name: string, buf: ArrayBuffer) => detectFormat(makeProbe(name, buf));
const best = (name: string, buf: ArrayBuffer) => detect(name, buf).candidates[0];

/* ------------------------------------------------------------------ probe */

describe('probe', () => {
  it('extracts a lower-cased, dot-prefixed extension', () => {
    expect(extensionOf('Part.STEP')).toBe('.step');
    expect(extensionOf('/a/b/Model.glTF')).toBe('.gltf');
    expect(extensionOf('archive.tar.gz')).toBe('.gz');
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.gitignore')).toBe(''); // a dotfile is not an extension
  });

  it('extracts a basename from either separator', () => {
    expect(basenameOf('C:\\models\\Part.STL')).toBe('part.stl');
    expect(basenameOf('/tmp/a/b/part.stl')).toBe('part.stl');
  });

  it('decodes text and strips a UTF-8 BOM', () => {
    const p = makeProbe('a.obj', bytes('\uFEFFv 1 2 3\nf 1 1 1\n'));
    expect(p.text.startsWith('v 1 2 3')).toBe(true);
  });

  it('reports empty text for binary content so text sniffers cannot misfire', () => {
    expect(makeProbe('a.bin', W.stlBinary(mm)).text).toBe('');
  });

  it('reports the total size, not the truncated head size', () => {
    const big = new Uint8Array(20_000).fill(0x41);
    const p = makeProbe('a.txt', big.buffer as ArrayBuffer);
    expect(p.size).toBe(20_000);
    expect(p.head.length).toBe(8192);
  });
});

/* -------------------------------------------------------------------- zip */

describe('zip header reading', () => {
  it('reads the first entry name without inflating', () => {
    const z = new Uint8Array(W.threemf('millimeter'));
    const view = new DataView(z.buffer, z.byteOffset, z.byteLength);
    expect(isZip(view)).toBe(true);
    expect(firstZipEntryName(z, view)).toBe('[Content_Types].xml');
  });

  it('recognises an empty archive as a ZIP but yields no first entry', () => {
    const empty = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
    const view = new DataView(empty.buffer);
    expect(zipSignature(view)).not.toBeNull();
    expect(firstZipEntryName(empty, view)).toBeNull();
  });

  it('returns null for non-ZIP bytes', () => {
    const u8 = new Uint8Array(W.stlBinary(mm));
    expect(firstZipEntryName(u8, new DataView(u8.buffer))).toBeNull();
  });
});

/* -------------------------------------------------------- positive matches */

interface PositiveCase {
  readonly label: string;
  readonly file: string;
  readonly buf: ArrayBuffer;
  readonly expect: FormatId;
  /** Strong sniffs must survive the filename being wrong. */
  readonly strong: boolean;
}

const POSITIVES: PositiveCase[] = [
  { label: 'GLB', file: 'box.glb', buf: W.glb(mm), expect: 'gltf', strong: true },
  { label: 'glTF JSON', file: 'box.gltf', buf: W.gltfSeparate(mm).gltf, expect: 'gltf', strong: true },
  { label: 'PLY ascii', file: 'box.ply', buf: W.plyAscii(mm), expect: 'ply', strong: true },
  { label: 'PLY binary LE', file: 'box.ply', buf: W.plyBinary(mm, true), expect: 'ply', strong: true },
  { label: 'PLY binary BE', file: 'box.ply', buf: W.plyBinary(mm, false), expect: 'ply', strong: true },
  { label: 'STL binary', file: 'box.stl', buf: W.stlBinary(mm), expect: 'stl', strong: true },
  { label: 'STL ascii', file: 'box.stl', buf: W.stlAscii(mm), expect: 'stl', strong: false },
  { label: 'OBJ', file: 'box.obj', buf: W.objMtl(mm).obj, expect: 'obj', strong: false },
  { label: 'USDA', file: 'box.usda', buf: W.usda(0.001, 'Y'), expect: 'usd', strong: true },
  { label: 'USDC', file: 'box.usdc', buf: W.usdcMagicOnly(), expect: 'usd', strong: true },
  { label: 'USDZ', file: 'box.usdz', buf: W.usdz(0.001, 'Y'), expect: 'usd', strong: true },
  { label: '3MF', file: 'box.3mf', buf: W.threemf('millimeter'), expect: '3mf', strong: true },
  { label: 'FBX binary', file: 'box.fbx', buf: W.fbxBinaryMagicOnly(), expect: 'fbx', strong: true },
];

describe('positive detection', () => {
  it.each(POSITIVES)('identifies $label', ({ file, buf, expect: want }) => {
    const d = detect(file, buf);
    expect(d.candidates[0]).toBe(want);
    expect(d.confidence).not.toBe('none');
  });

  it.each(POSITIVES.filter((c) => c.strong))(
    'identifies $label even when the filename lies',
    ({ buf, expect: want }) => {
      expect(best('blob.dat', buf)).toBe(want);
    },
  );

  it('identifies STEP from a real fixture header', () => {
    const step = 'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'\'),\'2;1\');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
    expect(best('part.step', bytes(step))).toBe('step');
    expect(best('renamed.dat', bytes(step))).toBe('step'); // strong: magic beats the name
  });

  it('identifies IGES by the column-73 section letter', () => {
    const line = (body: string, sec: string, n: number) =>
      body.padEnd(72, ' ') + sec + String(n).padStart(7, ' ');
    const iges = [line('preview test', 'S', 1), line('1H,,1H;', 'G', 1), line('', 'D', 1)].join('\n');
    expect(best('part.igs', bytes(iges))).toBe('iges');
  });

  it('identifies BREP', () => {
    expect(best('shape.brep', bytes('DBRep_DrawableShape\n\nCASCADE Topology V3\n'))).toBe('brep');
  });
});

/* ---------------------------------------------------- negatives and traps */

describe('negatives and traps', () => {
  it('returns no candidates for an empty file', () => {
    const d = detect('empty.dat', new ArrayBuffer(0));
    expect(d.candidates).toEqual([]);
    expect(d.confidence).toBe('none');
  });

  it('returns no candidates for a 3-byte file', () => {
    expect(detect('tiny.dat', bytes('abc')).candidates).toEqual([]);
  });

  it('returns no candidates for plain prose', () => {
    const prose = 'The quick brown fox jumps over the lazy dog.\nIt does this repeatedly.\n';
    expect(detect('notes.txt', bytes(prose)).candidates).toEqual([]);
  });

  // THE trap: exporters routinely write a literal ASCII "solid ..." into a BINARY STL's
  // 80-byte header. A text-first check calls this ASCII and the parse produces garbage.
  it('classifies a binary STL whose header begins "solid" as STL, via the length check', () => {
    const buf = W.stlBinary(mm, 'solid this is really a binary stl');
    const d = detect('trap.stl', buf);
    expect(d.candidates[0]).toBe('stl');
    expect(d.confidence).toBe('strong'); // strong == the length check matched, not the text
  });

  // The ordering of the STL checks is defence in depth; THIS is the invariant that actually
  // defeats the trap, and it is the one a future edit could plausibly break.
  it('scans far enough for a NUL that a binary STL can never decode as text', () => {
    expect(BINARY_SNIFF_BYTES).toBeGreaterThanOrEqual(84);
    const trap = new Uint8Array(W.stlBinary(mm, 'solid this is really a binary stl'));
    // The count field at 80..83 is what carries the NUL, for any realistic triangle count.
    expect(trap.subarray(80, 84)).toContain(0);
    expect(makeProbe('trap.stl', trap.buffer as ArrayBuffer).text).toBe('');
  });

  it('still detects an ASCII STL hidden behind a UTF-8 BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new Uint8Array(W.stlAscii(mm))]);
    expect(best('bom.stl', withBom.buffer as ArrayBuffer)).toBe('stl');
  });

  it('detects a GLB that has been misnamed .gltf', () => {
    expect(best('actually-binary.gltf', W.glb(mm))).toBe('gltf');
  });

  it('detects a PLY that has been misnamed .stl', () => {
    // The extension says stl, the bytes say ply. The bytes win.
    expect(best('mislabelled.stl', W.plyAscii(mm))).toBe('ply');
  });

  it('routes a truncated GLB to the glTF plugin rather than giving up', () => {
    const full = new Uint8Array(W.glb(mm));
    const cut = full.slice(0, full.length - 40); // header length field now disagrees
    const d = detect('cut.glb', cut.buffer as ArrayBuffer);
    // Better to hand it to glTF and surface a real parse error than to say "unknown format".
    expect(d.candidates[0]).toBe('gltf');
    expect(d.confidence).not.toBe('strong');
  });

  it('does not mistake an MTL library for an OBJ', () => {
    const d = detect('box.mtl', W.objMtl(mm).mtl);
    expect(d.candidates).not.toContain('obj');
  });

  it('does not claim a ZIP that is neither USDZ nor 3MF', () => {
    const other = zipSync({ 'readme.txt': enc.encode('hello'), 'data.csv': enc.encode('a,b\n') });
    const d = detect('bundle.zip', other.buffer as ArrayBuffer);
    expect(d.candidates).not.toContain('usd');
    expect(d.candidates).not.toContain('3mf');
  });

  it('does not claim an empty ZIP archive', () => {
    const empty = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
    const d = detect('empty.zip', empty.buffer as ArrayBuffer);
    expect(d.candidates).toEqual([]);
  });

  it('falls back to the extension for an IGES with trimmed trailing whitespace', () => {
    // Column 73 is gone, so the sniffer cannot fire; only the extension can save it.
    const trimmed = 'preview test,,1H;\n1H,,1H;\n';
    const d = detect('part.iges', bytes(trimmed));
    expect(d.candidates).toContain('iges');
    expect(d.confidence).toBe('extension');
  });
});

/* ------------------------------------------------------------- hint & table */

describe('hint and sniffer table', () => {
  it('an explicit hint short-circuits everything', () => {
    const d = detectFormat(makeProbe('box.stl', W.stlBinary(mm)), 'ply');
    expect(d).toEqual({ candidates: ['ply'], confidence: 'hint' });
  });

  it('every FormatId has exactly one sniffer', () => {
    expect(SNIFFERS.map((s) => s.id).sort()).toEqual([...FORMAT_IDS].sort());
  });

  it('extensions are lower-cased and dot-prefixed', () => {
    for (const s of SNIFFERS) {
      for (const e of s.extensions) {
        expect(e, `${s.id}: ${e}`).toMatch(/^\.[a-z0-9]+$/);
      }
    }
  });

  it('no extension is claimed by two sniffers', () => {
    const seen = new Map<string, FormatId>();
    for (const s of SNIFFERS) {
      for (const e of s.extensions) {
        expect(seen.has(e), `${e} claimed by ${seen.get(e)} and ${s.id}`).toBe(false);
        seen.set(e, s.id);
      }
    }
  });

  it('formatsForExtension is case-insensitive', () => {
    expect(formatsForExtension('.STL')).toEqual(['stl']);
    expect(formatsForExtension('.nope')).toEqual([]);
  });

  it('acceptAttribute lists every extension', () => {
    const accept = acceptAttribute().split(',');
    expect(accept).toContain('.step');
    expect(accept).toContain('.usdz');
    expect(accept.length).toBe(SNIFFERS.flatMap((s) => s.extensions).length);
  });
});
