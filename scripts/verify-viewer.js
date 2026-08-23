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

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

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
  try {
    return require_('node:child_process').execSync(`command -v ${c}`, { stdio: 'pipe' }).length > 0;
  } catch {
    return false;
  }
});
if (!chromeBin) {
  console.error('[verify-viewer] no Chrome found on PATH; skipping.');
  server.close();
  process.exit(0);
}

await rm(PROFILE, { recursive: true, force: true });
const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const cleanup = async (code) => {
  chrome.kill();
  server.close();
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
};

let target = null;
for (let i = 0; i < 80 && !target; i++) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).find(
      (t) => t.type === 'page',
    );
  } catch {
    /* not up yet */
  }
  if (!target) await new Promise((r) => setTimeout(r, 250));
}
if (!target) {
  console.error('[verify-viewer] Chrome did not expose a debug target.');
  await cleanup(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const errors = [];
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
    errors.push(m.params.entry.text);
};
await new Promise((r) => {
  ws.onopen = r;
});
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 900,
  height: 600,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });

const evalJs = async (expression, awaitPromise = false) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }))?.result
    ?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const setReducedMotion = async (value) => {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }],
  });
  const want = value === 'reduce';
  for (let i = 0; i < 40; i++) {
    const seen = await evalJs(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
    if (seen === want) break;
    await wait(50);
  }
  // and let the resulting React commit flush before anything is measured
  await wait(150);
};

const waitFor = async (expression, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    if (await evalJs(expression)) return true;
    await wait(250);
  }
  return false;
};

const reload = async () => {
  await send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });
  return waitFor(`!!document.querySelector('[data-sample]')`);
};

/** Build a File in the page and dispatch a real DragEvent sequence at the document. */
const dispatchDrag = (types, phases, name = 'x.stl', content = '') =>
  evalJs(`
(() => {
  const dt = new DataTransfer();
  ${types.includes('Files') ? `dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}));` : `dt.setData('text/plain', 'hello');`}
  for (const phase of ${JSON.stringify(phases)}) {
    document.dispatchEvent(new DragEvent(phase, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }
  return true;
})()`);

const overlayVisible = () => evalJs(`!!document.querySelector('.drop-overlay')`);

await reload();

const click = async (selector) => {
  const ok = await evalJs(
    `(()=>{const e=document.querySelector('${selector}');if(!e)return false;e.click();return true;})()`,
  );
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
    if (
      Math.abs(a.data[i] - b.data[i]) > tol ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > tol ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > tol
    )
      differing++;
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
const timeArrival = (from, to, idleMs) =>
  evalJs(
    `
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
})`,
    true,
  );

try {
  // Reduced motion for the framing checks, so transitions settle deterministically.
  await setReducedMotion('reduce');

  // 1. Scale invariance. Every camera constant is a multiple of the bounding-sphere radius
  //    and nothing rescales the model, so world scale must not change a single pixel.
  const frames = {};
  for (const sample of ['stl-mm', 'stl-m', 'stl-big']) {
    await reload();
    await click(`[data-sample="${sample}"]`);
    await waitFor(`!!document.querySelector('[data-view="iso"]')`);
    await click('[data-view="iso"]');
    frames[sample] = await shot();
  }
  check(
    'the render is not blank',
    inkPct(frames['stl-mm']) > 2,
    `${inkPct(frames['stl-mm']).toFixed(1)}% ink`,
  );
  const dScale = diffPct(frames['stl-mm'], frames['stl-m']);
  const dHuge = diffPct(frames['stl-mm'], frames['stl-big']);
  check(
    'the same box authored in mm and in m frames identically',
    dScale < 0.5,
    `${dScale.toFixed(3)}% differ`,
  );
  check('a 1000x larger box frames identically', dHuge < 0.5, `${dHuge.toFixed(3)}% differ`);

  // A different format of the same shape must load and render, but is NOT pixel-comparable:
  // PLY carries no normals, so buildScene derives smoothed ones where STL has flat facets.
  await reload();
  await click('[data-sample="ply"]');
  await waitFor(`!!document.querySelector('[data-view="iso"]')`);
  await click('[data-view="iso"]');
  const plyFrame = await shot();
  check(
    'a PLY sample loads and renders',
    inkPct(plyFrame) > 2,
    `${inkPct(plyFrame).toFixed(1)}% ink`,
  );

  // The headline formats, each checked for the thing that makes it distinctive.
  const statOf = (name) =>
    evalJs(`document.querySelector('[data-stat="${name}"]')?.textContent ?? ''`);

  await reload();
  await click('[data-sample="glb"]');
  await waitFor(`!!document.querySelector('[data-view="iso"]')`);
  await click('[data-view="iso"]');
  const glbFrame = await shot();
  check(
    'a GLB sample loads and renders',
    inkPct(glbFrame) > 2,
    `${inkPct(glbFrame).toFixed(1)}% ink`,
  );
  check('glTF reports 12 triangles', (await statOf('triangles')) === '12');
  // The spec mandates metres, so the box must read as real millimetres, not bare units.
  const glbDims = await statOf('dimensions');
  check('glTF reports real units', /mm/.test(glbDims), glbDims);

  await reload();
  await click('[data-sample="usda"]');
  await waitFor(`!!document.querySelector('[data-view="iso"]')`);
  await click('[data-view="iso"]');
  const usdFrame = await shot();
  check(
    'a USD sample loads and renders',
    inkPct(usdFrame) > 2,
    `${inkPct(usdFrame).toFixed(1)}% ink`,
  );
  check('USD reports 12 triangles', (await statOf('triangles')) === '12');
  const usdDims = await statOf('dimensions');
  // The stage is authored in millimetres AND Z-up; both conversions must land it at
  // 10 x 20 x 30 mm, upright, the same as every other format of the same box.
  check(
    'USD converts its stage units and up-axis',
    /^10\.000 × 20\.000 × 30\.000 mm$/.test(usdDims),
    usdDims,
  );

  // OBJ, whose materials live in a separate .mtl. Loading the sample drops both files, so
  // this exercises the same companion resolution a folder drop uses.
  await reload();
  await click('[data-sample="obj"]');
  await waitFor(`!!document.querySelector('[data-view="iso"]')`, 120);
  await click('[data-view="iso"]');
  const objFrame = await shot();
  check(
    'an OBJ sample loads and renders',
    inkPct(objFrame) > 2,
    `${inkPct(objFrame).toFixed(1)}% ink`,
  );
  check('OBJ reports 12 triangles', (await statOf('triangles')) === '12');
  // No missing-companion warning means the .mtl really was found through the drop.
  const objWarnings = await evalJs(
    `[...document.querySelectorAll('.warning-list li')].map(e => e.textContent).join(' | ')`,
  );
  check(
    'the companion .mtl was resolved',
    !/not included/i.test(objWarnings),
    objWarnings || '(none)',
  );
  // OBJ declares no units, so the ruler must not invent any.
  const objDims = await statOf('dimensions');
  check('OBJ reports abstract units', / u$/.test(objDims), objDims);

  // Resolving the .mtl is only half of it — the material has to reach the renderer. The
  // same box in the same view, shaded by Kd 0.80 0.35 0.20 rather than the default grey,
  // must look substantially different.
  await reload();
  await click('[data-sample="stl-mm"]');
  await waitFor(`!!document.querySelector('[data-view="iso"]')`);
  await click('[data-view="iso"]');
  const greyFrame = await shot();
  const objVsGrey = diffPct(objFrame, greyFrame);
  check(
    'the MTL colour reaches the renderer',
    objVsGrey > 5,
    `${objVsGrey.toFixed(1)}% of pixels differ from the default grey`,
  );

  // 8b. The worker must actually be doing the work, and CAD parsing must not add a
  //     main-thread block. Passing checks prove nothing here if the code silently fell back
  //     to parsing inline.
  //
  //     Measured as the MARGINAL cost over a trivial STL rather than in absolute terms:
  //     under SwiftShader the first draw compiles shaders for about a second whatever the
  //     format, so an absolute threshold would measure the software renderer instead of
  //     anything this project controls.
  const longestTaskFor = async (sample) => {
    await reload();
    await evalJs(`(() => {
      window.__workers = [];
      window.__blocked = 0;
      const Real = window.Worker;
      window.Worker = function (url, opts) { window.__workers.push(String(url)); return new Real(url, opts); };
      window.Worker.prototype = Real.prototype;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__blocked = Math.max(window.__blocked, e.duration);
      }).observe({ entryTypes: ['longtask'] });
      return true;
    })()`);
    await wait(1500);
    await evalJs(`window.__blocked = 0`);
    await click(`[data-sample="${sample}"]`);
    await waitFor(`!!document.querySelector('[data-view="iso"]')`, 200);
    await wait(1200);
    return {
      blocked: await evalJs(`window.__blocked ?? 0`),
      workers: await evalJs(`(window.__workers ?? []).join(' | ')`),
    };
  };

  const stlRun = await longestTaskFor('stl-mm');
  const stepRun = await longestTaskFor('step');
  check(
    'a STEP load really runs in the parse worker',
    /parse\.worker/.test(stepRun.workers),
    stepRun.workers || '(none)',
  );
  const marginal = stepRun.blocked - stlRun.blocked;
  check(
    'CAD parsing adds no main-thread block of its own',
    marginal < 250,
    `STEP ${Math.round(stepRun.blocked)} ms vs STL ${Math.round(stlRun.blocked)} ms — ${Math.round(marginal)} ms marginal`,
  );

  await reload();
  // A STEP solid: the stretch goal, and the case where the ruler finally reports a real
  // physical length from a CAD file rather than from a format that merely mandates metres.
  await reload();
  await click('[data-sample="step"]');
  await waitFor(`!!document.querySelector('[data-view="iso"]')`, 200);
  await click('[data-view="iso"]');
  const stepFrame = await shot();
  check(
    'a STEP sample loads and renders',
    inkPct(stepFrame) > 2,
    `${inkPct(stepFrame).toFixed(1)}% ink`,
  );
  check('STEP tessellates to 12 triangles', (await statOf('triangles')) === '12');
  const stepDims = await statOf('dimensions');
  check(
    'STEP reports the declared physical size',
    /^10\.000 × 20\.000 × 30\.000 mm$/.test(stepDims),
    stepDims,
  );

  // 2. Every view button.
  await reload();
  await click('[data-sample="stl-mm"]');
  await waitFor(`!!document.querySelector('[data-view="iso"]')`);
  const views = ['front', 'back', 'right', 'left', 'top', 'bottom', 'iso'];
  const viewFrames = {};
  for (const v of views) {
    await click(`[data-view="${v}"]`);
    viewFrames[v] = await shot();
    const pressedNow = await evalJs(
      `[...document.querySelectorAll('[data-view]')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.view).join(',')`,
    );
    check(
      `${v}: renders and reports aria-pressed`,
      pressedNow === v,
      `aria-pressed=${pressedNow || 'none'}`,
    );
  }
  let differingPairs = 0;
  for (let i = 0; i < views.length; i++)
    for (let j = i + 1; j < views.length; j++)
      if (diffPct(viewFrames[views[i]], viewFrames[views[j]]) > 1) differingPairs++;
  check(
    'the seven views are visually distinct',
    differingPairs >= 18,
    `${differingPairs}/21 pairs differ`,
  );

  await click('[data-view="fit"]');
  check('Fit runs without error', true);

  // Keyboard shortcuts. These existed, were silently dropped by a refactor, and nothing
  // noticed — so they are checked end to end now, not only as pure key mapping.
  const pressKey = (key) =>
    evalJs(`(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown',
      { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    return true;
  })()`);
  const pressedView = () =>
    evalJs(
      `[...document.querySelectorAll('[data-view]')].find(b=>b.getAttribute('aria-pressed')==='true')?.dataset.view ?? ''`,
    );

  await click('[data-view="iso"]');
  await pressKey('5');
  await wait(900);
  check('the "5" shortcut snaps to Top', (await pressedView()) === 'top');
  await pressKey('1');
  await wait(900);
  check('the "1" shortcut snaps to Front', (await pressedView()) === 'front');
  await pressKey('f');
  await wait(900);
  check('the "f" shortcut runs Fit without error', true);

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
  check(
    'prefers-reduced-motion snaps instantly',
    reduced !== null && reduced < 120,
    `${Math.round(reduced)} ms`,
  );
  // 6. Drag and drop.
  await reload();
  check(
    'the empty state is shown before anything is loaded',
    await evalJs(`!!document.querySelector('.empty-state')`),
  );

  await dispatchDrag(['Files'], ['dragenter', 'dragover']);
  await wait(120);
  check('the drop overlay appears for a file drag', await overlayVisible());

  // THE watchdog case: a drag that exits past the window edge fires no dragleave, so the
  // overlay must time out on its own or it latches on forever.
  await wait(700);
  check('a drag that leaves without a dragleave times out', !(await overlayVisible()));

  await dispatchDrag(['text/plain'], ['dragenter', 'dragover']);
  await wait(120);
  check('dragging text shows no overlay', !(await overlayVisible()));
  await dispatchDrag(['Files'], ['dragend']);

  // A real drop of a real STL.
  const stlAscii = [
    'solid box',
    ...Array.from(
      { length: 1 },
      () =>
        'facet normal 0 0 1\n outer loop\n  vertex 0 0 0\n  vertex 1 0 0\n  vertex 0 1 0\n endloop\nendfacet',
    ),
    'endsolid box',
  ].join('\n');
  await dispatchDrag(['Files'], ['dragenter', 'dragover', 'drop'], 'dropped.stl', stlAscii);
  const loaded = await waitFor(
    `document.querySelector('[data-stat="triangles"]')?.textContent === '1'`,
    40,
  );
  check('dropping an STL loads it', loaded);
  check('the overlay is gone after a drop', !(await overlayVisible()));
  check(
    'the empty state is replaced by the viewer',
    !(await evalJs(`!!document.querySelector('.empty-state')`)),
  );

  // Going back to the empty state, and loading something else from there.
  check(
    'the back button is offered once a model is open',
    await evalJs(`!!document.querySelector('[data-action="back"]')`),
  );
  await click('[data-action="back"]');
  check(
    'back returns to the empty state',
    await evalJs(`!!document.querySelector('.empty-state')`),
  );
  check(
    'the viewer is gone with it',
    !(await evalJs(`!!document.querySelector('[data-view="iso"]')`)),
  );
  await click('[data-sample="ply"]');
  await waitFor(`!!document.querySelector('[data-view="iso"]')`);
  check(
    'a different model can be chosen after going back',
    (await evalJs(`document.querySelector('.filename')?.textContent ?? ''`)).includes('.ply'),
  );

  // Dropping must still replace in place, without a detour through the empty state.
  await dispatchDrag(['Files'], ['dragenter', 'dragover', 'drop'], 'after-back.stl', stlAscii);
  const replaced = await waitFor(
    `(document.querySelector('.filename')?.textContent ?? '').includes('after-back.stl')`,
    40,
  );
  check('dropping still replaces in place after going back', replaced);

  // An unrecognised file must explain itself rather than fail silently.
  await dispatchDrag(
    ['Files'],
    ['dragenter', 'dragover', 'drop'],
    'notes.txt',
    'just prose, not a model',
  );
  const errored = await waitFor(`!!document.querySelector('[role="alert"]')`, 30);
  check('dropping an unsupported file reports an error', errored);
  const errText = await evalJs(`document.querySelector('[role="alert"]')?.textContent ?? ''`);
  check('the error names the supported formats', /\.stl/.test(errText));

  // 7. Repeated loads must not leak. Disposal is asserted per-format in the unit suite;
  //    what that cannot show is whether the app actually CALLS dispose when a model is
  //    replaced. A big mesh makes a leak measurable: each one holds ~1.7 MB of Float32
  //    attributes, so five leaked models would be plainly visible above heap noise.
  const bigStl = `(() => {
    const n = 8000;
    const out = ['solid big'];
    for (let i = 0; i < n; i++) {
      const x = (i % 100) * 0.1, y = ((i / 100) | 0) * 0.1;
      out.push('facet normal 0 0 1', ' outer loop',
        \` vertex \${x} \${y} 0\`, \` vertex \${x + 0.1} \${y} 0\`, \` vertex \${x} \${y + 0.1} 0\`,
        ' endloop', 'endfacet');
    }
    out.push('endsolid big');
    return out.join('\\n');
  })()`;

  await reload();
  await click('[data-sample="stl-mm"]');
  await waitFor(`!!document.querySelector('[data-view="iso"]')`);

  const heap = async () => {
    await send('HeapProfiler.collectGarbage');
    await wait(250);
    return evalJs(`performance.memory ? performance.memory.usedJSHeapSize : 0`);
  };

  const dropBig = async (i) => {
    await evalJs(`(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([${bigStl}], 'big${i}.stl'));
      for (const p of ['dragenter','dragover','drop'])
        document.dispatchEvent(new DragEvent(p, { dataTransfer: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    const ok = await waitFor(
      `(document.querySelector('.filename')?.textContent ?? '').includes('big${i}.stl')`,
      80,
    );
    if (!ok) throw new Error(`big load ${i} did not complete`);
  };

  await dropBig(0);
  const heapAfterFirst = await heap();
  for (let i = 1; i <= 5; i++) await dropBig(i);
  const heapAfterSix = await heap();

  const growthMb = (heapAfterSix - heapAfterFirst) / (1024 * 1024);
  const perModelMb = (8000 * 3 * 3 * 4 * 2) / (1024 * 1024); // positions + normals, Float32
  check(
    'replacing a model five times does not accumulate geometry',
    heapAfterFirst === 0 || growthMb < perModelMb * 2,
    heapAfterFirst === 0
      ? 'performance.memory unavailable — skipped'
      : `grew ${growthMb.toFixed(1)} MB; five leaked models would be ~${(perModelMb * 5).toFixed(1)} MB`,
  );

  await reload();
  await click('[data-sample="stl-mm"]');
  await waitFor(`!!document.querySelector('[data-view="iso"]')`);
  for (let i = 0; i < 5; i++) {
    // Each drop REPLACES the open model in place — no round trip through the empty state,
    // which is what the previous model's disposal depends on. Waiting on the filename
    // rather than the triangle count, because the count is identical every round and a
    // stale match would let a failed load pass.
    await dispatchDrag(['Files'], ['dragenter', 'dragover', 'drop'], `round${i}.stl`, stlAscii);
    const ok = await waitFor(
      `(document.querySelector('.filename')?.textContent ?? '').includes('round${i}.stl')`,
      40,
    );
    if (!ok) throw new Error(`load ${i + 1} of 5 did not complete`);
  }
  await click('[data-view="iso"]');
  const afterFive = await shot();
  check(
    'five sequential loads all succeed and still render',
    inkPct(afterFive) > 1,
    `${inkPct(afterFive).toFixed(1)}% ink`,
  );
  // 8. The measurement ruler. The requirement is explicitly that it reports REAL units for
  //    a format that declares them and ABSTRACT units for one that does not, so both are
  //    checked, on the same physical box.
  const clickCanvas = (dx, dy) =>
    evalJs(`(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const x = r.left + r.width / 2 + ${dx};
    const y = r.top + r.height / 2 + ${dy};
    const opts = { clientX: x, clientY: y, bubbles: true, cancelable: true,
                   pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true };
    c.dispatchEvent(new PointerEvent('pointerdown', opts));
    c.dispatchEvent(new PointerEvent('pointerup', opts));
    return true;
  })()`);
  const rows = () =>
    evalJs(
      `[...document.querySelectorAll('[data-measure-row]')].map(b => b.querySelector('.measure-value').textContent)`,
    );

  const measureOn = async (sample) => {
    await reload();
    await click(`[data-sample="${sample}"]`);
    await waitFor(`!!document.querySelector('[data-view="iso"]')`);
    await click('[data-view="iso"]');
    await click('[data-action="measure-toggle"]');
    await clickCanvas(-30, 10);
    await wait(250);
    await clickCanvas(40, -20);
    await waitFor(`document.querySelectorAll('[data-measure-row]').length === 1`, 30);
    return (await rows())[0] ?? '';
  };

  // A USD stage declares millimetres, so the ruler must report a real length.
  const usdValue = await measureOn('usda');
  check(
    'measuring a USD model reports real units',
    /^[\d.]+\s*(mm|cm|m)$/.test(usdValue),
    usdValue,
  );
  const usdNumber = parseFloat(usdValue);
  check(
    'the USD measurement is inside the model',
    usdNumber > 0 && usdNumber <= 40,
    `${usdNumber}`,
  );

  // STL declares nothing, so the same click must give a bare number, never an invented unit.
  const stlValue = await measureOn('stl-mm');
  check('measuring an STL reports abstract units', /^[\d.]+\s*u$/.test(stlValue), stlValue);

  // Deterministic correctness: two clicks at the SAME screen point must measure exactly
  // zero. A plausible-looking number proves the plumbing runs; this proves it is right.
  await evalJs(`document.querySelector('[data-measure-delete]')?.click()`);
  await wait(250);
  await clickCanvas(12, -8);
  await wait(250);
  await clickCanvas(12, -8);
  await waitFor(`document.querySelectorAll('[data-measure-row]').length === 1`, 30);
  const zero = (await rows())[0] ?? '';
  check('measuring one point against itself gives exactly zero', parseFloat(zero) === 0, zero);

  // Deleting, and the Escape ladder.
  await evalJs(`document.querySelector('[data-measure-delete]')?.click()`);
  await wait(300);
  check('a measurement can be deleted', (await rows()).length === 0);

  await clickCanvas(-30, 10);
  await wait(250);
  await evalJs(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  );
  await wait(250);
  await clickCanvas(40, -20);
  await wait(400);
  check('Escape abandons a half-finished measurement', (await rows()).length === 0);
} catch (err) {
  check(`harness error: ${err.message}`, false);
}

console.log('');
for (const r of results)
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `   [${r.detail}]` : ''}`);
const failed = results.filter((r) => !r.pass).length;
if (errors.length) {
  console.log('\n  browser errors:');
  for (const e of [...new Set(errors)].slice(0, 10)) console.log(`    ${e}`);
}
console.log(`\n  ${results.length - failed}/${results.length} checks passed\n`);
await cleanup(failed || errors.length ? 1 : 0);
