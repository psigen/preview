// Stage third-party decoder assets into public/vendor/ so they are served same-origin,
// unhashed, and out of the JS bundle. Mirrors videoclip's scripts/copy-ffmpeg.mjs.
//
// Why public/ and not a bundler import:
//   * DRACOLoader.setDecoderPath(dir) and KTX2Loader.setTranscoderPath(dir) concatenate
//     filenames onto that directory AT RUNTIME, so they cannot be handed content-hashed
//     asset URLs. A stable unhashed directory is a hard requirement for those two.
//   * For occt it is also an LGPL-2.1 obligation — see the note on the occt entry below.
//
// Two modes:
//   (default)  postinstall — warn on a missing source, exit 0
//   --check    prebuild    — exit 1 on any missing or stale file, so a CI run with
//                            `npm ci --ignore-scripts` cannot silently deploy a broken app.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outRoot = join(root, 'public', 'vendor');
const check = process.argv.includes('--check');

/**
 * VITE_ENABLE_CAD=0 produces a build with no LGPL artifacts at all.
 *
 * The Open CASCADE wasm is the only encumbered dependency, and it is also by far the
 * largest thing shipped: 7.7 MB with its licence texts. Gating it here rather than only in
 * the bundle is what makes the flag meaningful, because the wasm never enters the bundle in
 * the first place — it is staged as a separate file precisely so LGPL relinking stays
 * possible.
 */
const cadEnabled = process.env.VITE_ENABLE_CAD !== '0';

// Resolve through the package exports map, never a hand-built node_modules/ path:
// three's exports expose "./examples/jsm/*" but have NO "./package.json" entry, so
// require.resolve('three/package.json') throws. import.meta.resolve also survives
// pnpm, workspaces, and hoisting differences.
function resolveSpec(spec) {
  try {
    return fileURLToPath(import.meta.resolve(spec));
  } catch {
    return null;
  }
}

/** Adding a decoder is one entry here. */
const VENDOR = [
  {
    // Only DRACOLoader's glTF-tuned decoder, and only its wasm pair. We never decode a
    // standalone .drc, and DRACO_GLTF_CONFIG references exactly these two files. The 512 kB
    // draco_decoder.js is the no-WebAssembly fallback, unreachable in any browser that can
    // run WebGL. Staging the full set would cost 1.8 MB instead of 250 kB.
    to: 'draco/gltf',
    from: 'three/examples/jsm/libs/draco/gltf/',
    files: ['draco_decoder.wasm', 'draco_wasm_wrapper.js'],
  },
  {
    to: 'basis',
    from: 'three/examples/jsm/libs/basis/',
    files: ['basis_transcoder.js', 'basis_transcoder.wasm'],
  },
  {
    to: 'occt',
    cad: true,
    from: 'occt-import-js/dist/',
    // occt-import-js.wasm is fetched at runtime and handed to the module factory as
    // `wasmBinary` (docs/SPIKES.md S2). The .js glue is NOT fetched — it bundles into the
    // worker chunk — but is staged anyway, unmodified and alongside its licences, so a
    // recipient has the complete library artifacts and can relink a rebuilt copy. That is
    // what LGPL-2.1 asks for, and it keeps the classic-worker fallback available.
    files: [
      'occt-import-js.wasm',
      'occt-import-js.js',
      'license.occt.txt',
      'license.occt-import-js.txt',
    ],
  },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let copied = 0;
let skipped = 0;
const missing = [];
const manifest = { generatedBy: 'scripts/copy-wasm.mjs', entries: {} };

let skippedCad = 0;

for (const group of VENDOR) {
  if (group.cad && !cadEnabled) {
    skippedCad += group.files.length;
    continue;
  }
  for (const name of group.files) {
    const srcPath = resolveSpec(group.from + name);
    if (!srcPath || !existsSync(srcPath)) {
      missing.push(group.from + name);
      continue;
    }
    const destPath = join(outRoot, group.to, name);
    const src = readFileSync(srcPath);

    // Idempotent: skip when the destination already matches by size.
    let destSize = -1;
    try {
      destSize = statSync(destPath).size;
    } catch {
      /* not staged yet */
    }
    if (destSize !== src.length) {
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, src);
      copied++;
    } else {
      skipped++;
    }
    manifest.entries[`${group.to}/${name}`] = { bytes: src.length, sha256: sha256(src) };
  }
}

if (missing.length) {
  const msg = `[copy-wasm] missing ${missing.length} source file(s):\n  ${missing.join('\n  ')}`;
  if (check) {
    console.error(`${msg}\n[copy-wasm] run \`npm install\` (or \`npm run stage-wasm\`) before building.`);
    process.exit(1);
  }
  console.warn(msg);
} else {
  mkdirSync(outRoot, { recursive: true });
  writeFileSync(join(outRoot, 'VENDOR.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

const total = copied + skipped;
console.log(
  `[copy-wasm] ${total} file(s) staged in public/vendor (${copied} written, ${skipped} unchanged)` +
    (skippedCad ? `; ${skippedCad} CAD file(s) skipped (VITE_ENABLE_CAD=0)` : '') +
    (check ? ' — check passed' : ''),
);
