// Belt-and-braces companion to the eslint no-restricted-imports rule: fail if any source
// file contains an absolute http(s) URL that could be fetched at runtime. The app must work
// fully offline once loaded.
//
// index.html is scanned as well as src/, because that is exactly where a stylesheet or font
// <link> would be added.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const srcRoot = join(root, 'src');
const EXTRA_FILES = [join(root, 'index.html')];
const EXT = new Set(['.ts', '.tsx', '.css', '.html']);

const ALLOW = [
  // Prose <a href> targets. Rendered as links, never fetched.
  /github\.com/,
  /opensource\.org/,
  /threejs\.org/,
  /dev\.opencascade\.org/,
  /aousd\.org/,
  // XML namespace identifiers. These look like URLs but are never resolved.
  /www\.w3\.org\//,
  /schemas\.(openxmlformats|microsoft)\.com\//,
];

const offenders = [];

function scan(path) {
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const matches = line.match(/https?:\/\/[^\s'"`)]+/g);
      if (!matches) return;
      for (const url of matches) {
        if (ALLOW.some((re) => re.test(url))) continue;
        offenders.push(`${path.slice(root.length + 1)}:${i + 1}  ${url}`);
      }
    });
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!EXT.has(extname(p))) continue;
    scan(p);
  }
}

try {
  walk(srcRoot);
} catch {
  /* src/ may not exist yet */
}
for (const f of EXTRA_FILES) {
  try {
    scan(f);
  } catch {
    /* optional */
  }
}

if (offenders.length) {
  console.error('[check-no-network] runtime URLs found — the app must work offline:');
  for (const o of offenders) console.error('  ' + o);
  console.error('  Add to ALLOW in scripts/check-no-network.mjs only if it is never fetched.');
  process.exit(1);
}
console.log('[check-no-network] no runtime URLs in src/ or index.html');
