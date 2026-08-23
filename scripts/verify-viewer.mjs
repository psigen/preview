/**
 * End-to-end viewer check, driven through the real UI in a real browser.
 *
 * This exists because the things most likely to be wrong in the camera layer are invisible
 * to a unit test: they live in how our code talks to camera-controls and to the R3F render
 * loop. It has already caught two bugs that all 245 unit tests passed straight through —
 * reading a tween's destination instead of the camera's live position, and demand-mode idle
 * time collapsing every animated transition into a jump cut.
 *
 * Requires a built dist/ and a local Chrome. Not part of `npm test`, because CI has neither.
 *
 *   npm run build && npm run verify:viewer
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const { PNG } = require_('pngjs');

const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = 8745;
const DEBUG_PORT = 9345;
const PROFILE = '/tmp/preview-verify-profile';
const CHROME = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('[verify-viewer] no dist/ — run `npm run build` first.');
  process.exit(2);
}

const server = createServer(async (req, res) => {
  const path = join(DIST, decodeURIComponent((req.url ?? '/').split('?')[0]));
  const file = path.endsWith('/') ? join(path, 'index.html') : path;
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(PORT, r));

const chromeBin = CHROME.find((c) => {
  try { return require_('node:child_process').execSync(`command -v ${c}`, { stdio: 'pipe' }).length > 0; }
  catch { return false; }
});
if (!chromeBin) {
  console.error('[verify-viewer] no Chrome found on PATH; skipping.');
  server.close();
  process.exit(0);
}

await rm(PROFILE, { recursive: true, force: true });
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu-sandbox',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' });

const cleanup = async (code) => {
  chrome.kill();
  server.close();
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
};

let target = null;
for (let i = 0; i < 80 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  if (!target) await new Promise((r) => setTimeout(r, 250));
}
if (!target) { console.error('[verify-viewer] Chrome did not expose a debug target.'); await cleanup(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const errors = [];
const send = (method, params = {}) =>
  new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
};
await new Promise((r) => { ws.onopen = r; });
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });

const evalJs = async (expression, awaitPromise = false) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }))?.result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const setReducedMotion = (value) =>
  send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });

for (let i = 0; i < 80; i++) {
  if (await evalJs(`!!document.querySelector('[data-view="iso"]')`)) break;
  await wait(250);
}

const click = async (selector) => {
  const ok = await evalJs(`(()=>{const e=document.querySelector('${selector}');if(!e)return false;e.click();return true;})()`);
  if (!ok) throw new Error(`no element matching ${selector}`);
  await wait(700);
};

/** Hide the HUD: its text and pressed states differ per sample, and we compare the 3D framing. */
const shot = async () => {
  await evalJs(`document.querySelectorAll('.hud').forEach(e => e.style.visibility='hidden')`);
  await wait(150);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await evalJs(`document.querySelectorAll('.hud').forEach(e => e.style.visibility='')`);
  return PNG.sync.read(Buffer.from(r.data, 'base64'));
};

const diffPct = (a, b, tol = 8) => {
  if (a.width !== b.width || a.height !== b.height) return 100;
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol ||
        Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) differing++;
  }
  return (differing / (a.width * a.height)) * 100;
};
const inkPct = (img) => {
  let ink = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] > 40 || img.data[i + 1] > 40 || img.data[i + 2] > 45) ink++;
  }
  return (ink / (img.width * img.height)) * 100;
};

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

/** How long the camera takes to actually ARRIVE, measured by aria-pressed flipping. */
const timeArrival = (from, to, idleMs) => evalJs(`
new Promise(async (resolve) => {
  document.querySelector('[data-view="${from}"]').click();
  await new Promise(r => setTimeout(r, ${idleMs}));
  const btn = document.querySelector('[data-view="${to}"]');
  const t0 = performance.now();
  let arrived = null;
  const tick = () => {
    if (arrived === null && btn.getAttribute('aria-pressed') === 'true') arrived = performance.now() - t0;
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve(arrived);
  };
  btn.click();
  requestAnimationFrame(tick);
})`, true);

try {
  // Reduced motion for the framing checks, so transitions settle deterministically.
  await setReducedMotion('reduce');

  // 1. Scale invariance. Every camera constant is a multiple of the bounding-sphere radius
  //    and nothing rescales the model, so world scale must not change a single pixel.
  const frames = {};
  for (const sample of ['mm', 'm', 'big']) {
    await click(`[data-sample="${sample}"]`);
    await click('[data-view="iso"]');
    frames[sample] = await shot();
  }
  check('the render is not blank', inkPct(frames.mm) > 2, `${inkPct(frames.mm).toFixed(1)}% ink`);
  const dScale = diffPct(frames.mm, frames.m);
  const dHuge = diffPct(frames.mm, frames.big);
  check('the same part authored in mm and in m frames identically', dScale < 0.5, `${dScale.toFixed(3)}% differ`);
  check('10 mm and 100 m frame identically', dHuge < 0.5, `${dHuge.toFixed(3)}% differ`);

  // 2. Every view button.
  await click('[data-sample="mm"]');
  const views = ['front', 'back', 'right', 'left', 'top', 'bottom', 'iso'];
  const viewFrames = {};
  for (const v of views) {
    await click(`[data-view="${v}"]`);
    viewFrames[v] = await shot();
    const pressedNow = await evalJs(
      `[...document.querySelectorAll('[data-view]')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.view).join(',')`);
    check(`${v}: renders and reports aria-pressed`, pressedNow === v, `aria-pressed=${pressedNow || 'none'}`);
  }
  let differingPairs = 0;
  for (let i = 0; i < views.length; i++)
    for (let j = i + 1; j < views.length; j++)
      if (diffPct(viewFrames[views[i]], viewFrames[views[j]]) > 1) differingPairs++;
  check('the seven views are visually distinct', differingPairs >= 18, `${differingPairs}/21 pairs differ`);

  await click('[data-view="fit"]');
  check('Fit runs without error', true);

  // 3. Idempotence: a second press must not unwind and re-approach.
  await click('[data-view="top"]');
  const top1 = await shot();
  await click('[data-view="top"]');
  const dTop = diffPct(top1, await shot());
  check('pressing Top twice is a no-op', dTop < 0.05, `${dTop.toFixed(3)}% differ`);

  // 4. Transitions must animate, warm OR after the demand-mode loop has gone idle.
  await setReducedMotion('no-preference');
  const warm = await timeArrival('front', 'bottom', 30);
  const afterIdle = await timeArrival('front', 'bottom', 1800);
  check('a warm transition animates rather than jumping', warm > 120, `${Math.round(warm)} ms`);
  check('a transition after idle still animates', afterIdle > 120, `${Math.round(afterIdle)} ms`);

  // 5. Reduced motion must be respected.
  await setReducedMotion('reduce');
  const reduced = await timeArrival('front', 'bottom', 400);
  check('prefers-reduced-motion snaps instantly', reduced !== null && reduced < 120, `${Math.round(reduced)} ms`);
} catch (err) {
  check(`harness error: ${err.message}`, false);
}

console.log('');
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `   [${r.detail}]` : ''}`);
const failed = results.filter((r) => !r.pass).length;
if (errors.length) {
  console.log('\n  browser errors:');
  for (const e of [...new Set(errors)].slice(0, 10)) console.log(`    ${e}`);
}
console.log(`\n  ${results.length - failed}/${results.length} checks passed\n`);
await cleanup(failed || errors.length ? 1 : 0);
