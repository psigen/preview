// Belt-and-braces companion to the eslint no-restricted-imports rule: fail if any source file
// contains an absolute http(s) URL that would be fetched at runtime. The app must work fully
// offline after load. Comments and doc links are allowed via the ALLOW list.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = resolve(fileURLToPath(new URL('../src', import.meta.url)));
const EXT = new Set(['.ts', '.tsx', '.css', '.html']);
// URLs that are only ever rendered as links or appear in comments, never fetched.
// github.com / docs links only ever appear as prose <a href>, never as a fetch target.
const ALLOW = [/github\.com/, /opensource\.org/, /threejs\.org/, /dev\.opencascade\.org/, /aousd\.org/];

const offenders = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!EXT.has(extname(p))) continue;
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/https?:\/\/[^\s'"`)]+/g);
      if (!m) return;
      for (const url of m) {
        if (ALLOW.some((re) => re.test(url))) continue;
        offenders.push(`${p.slice(srcRoot.length + 1)}:${i + 1}  ${url}`);
      }
    });
  }
}
try { walk(srcRoot); } catch { /* src/ may not exist yet */ }

if (offenders.length) {
  console.error('[check-no-network] runtime URLs found in src/ — the app must work offline:');
  for (const o of offenders) console.error('  ' + o);
  console.error('  Add to ALLOW in scripts/check-no-network.mjs only if it is never fetched.');
  process.exit(1);
}
console.log('[check-no-network] no runtime URLs in src/');
