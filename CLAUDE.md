# preview

Client-side 3D mesh and CAD viewer. Drop a mesh or CAD file into the browser, orbit it, and
measure it. Everything runs in the browser — no backend, no upload — and it is deployed as a
static site to GitHub Pages. Sister app to [videoclip](https://github.com/psigen/videoclip),
whose conventions this deliberately mirrors.

## Commands

```bash
npm ci               # installs; postinstall stages decoders into public/vendor
npm run dev          # vite dev server on 5173
npm test             # vitest: the 'lib' (node) and 'dom' (jsdom) projects — the CI gate
npm run test:browser # optional tier: DRACO, KTX2, real workers, WebGL
npm run lint         # eslint + scripts/check-no-network.js
npm run verify:viewer # end-to-end camera checks in headless Chrome (needs dist/)
npm run build        # prebuild --check, then tsc && vite build
npm run preview      # serve dist/ on 4173
npm run stage-wasm   # re-run the decoder staging by hand
```

`npm run build` and `npm test` are both correctness gates, and CI runs lint, test, then build.
(videoclip has only `tsc`; this project has real tests because format support is the product.)

## Critical architectural constraints

These are deliberate and enforced across multiple files. Do not "fix" them without reading why.
Findings that established several of them are recorded in [docs/SPIKES.md](docs/SPIKES.md).

**No network at runtime.** The app must work fully offline after load. That bans drei's `Text`,
`Text3D`, `Environment`, `useEnvironment` and `Loader`, all of which fetch fonts or HDRIs from a
CDN. Use `<Html>` for in-scene text and `RoomEnvironment` + `PMREMGenerator` for lighting. This
is enforced by `no-restricted-imports` in [eslint.config.js](eslint.config.js) _and_ by
[scripts/check-no-network.js](scripts/check-no-network.js); prose alone erodes.

**No COOP/COEP, ever.** GitHub Pages cannot send those headers, so there is no
`SharedArrayBuffer` and no threaded wasm. Every decoder must be single-threaded.

**`src/lib/` is React-free.** `lib/` is pure logic, `hooks/` is the React surface over it,
`components/` is presentation. Keeping `lib/` free of React is what makes the loader stack and
all the camera/measurement maths testable in plain Node. Enforced by eslint.

**Never bake a fit or normalisation scale into a loaded model.** The only scales that may exist
are unit conversions a loader itself performed (USD) or that we asked a transcoder for (OCCT).
The camera fits to the bounds instead. A test asserts the decomposed `worldFromFile` scale is
uniform and that the root was never recentred.

**`metersPerUnit` is defined against WORLD space, after any transform a loader baked in.** A
loader that bakes a unit scale into its root must report `1`. One multiply, no branch, no
double-conversion.

**`occt-import-js` is handed `wasmBinary` directly.** All three of its emscripten environment
flags are false in a module worker, so it cannot fetch its own wasm there. Passing the bytes
short-circuits that entirely and makes it behave identically in a module worker, the main
thread, and Node. Never reintroduce `locateFile` or `BASE_URL` logic inside the worker.

**`three-mesh-bvh` stays pinned to `^0.8.3`.** That is what drei depends on. A different major
installs a second copy, and both patch `Mesh.prototype.raycast`, so a tree built by one could be
queried by the other.

**`public/vendor/` is generated and gitignored.** `DRACOLoader.setDecoderPath()` and
`KTX2Loader.setTranscoderPath()` concatenate filenames at runtime, so they cannot take
content-hashed asset URLs — a stable unhashed directory is a hard requirement. `prebuild` runs
`copy-wasm.js --check` so a `npm ci --ignore-scripts` CI can never deploy a broken vendor tree.

**LGPL:** `occt-import-js` is LGPL-2.1 and bundles Open CASCADE. Its `.wasm` must stay a
separate, unmodified, replaceable file, and both licence texts ship alongside it. Never
base64-inline it. `VITE_ENABLE_CAD=0` produces a build with no LGPL artifacts at all.

## Detection is its own library

[src/lib/detect/](src/lib/detect/) identifies a file from its bytes and nothing else — no three,
no DOM, no I/O, fully synchronous — with its own dedicated suite in `detect.test.ts`. It shares
only `FormatId` with the loader registry. Two subtleties worth knowing:

- Sniff-first, extension as tie-breaker. `detectFormat` returns an _ordered_ candidate list and
  the loader falls through on a parse throw.
- `BINARY_SNIFF_BYTES` in `probe.ts` must stay `>= 84`. A binary STL's triangle-count field at
  offsets 80..83 always contains a NUL, which is what stops its literal `solid ...` header from
  being read as an ASCII STL. There is a regression test pinning this.

## Formatting

Prettier owns it. `npm run format` writes, `npm run lint` checks, and CI fails on drift —
which exists because formatting one file in isolation once left it double-quoted against a
single-quoted codebase.

[prettier.config.js](prettier.config.js) overrides exactly two defaults, each with the reason
recorded beside it. Do not add a third without one. Where a table's layout carries meaning —
the box topology, the unit lookup — a `// prettier-ignore` pins it, with a comment saying
what the shape encodes. Note that comment must be exactly `// prettier-ignore`; trailing text
silently disables it.

Scripts and configs are plain `.js`, not `.mjs`: `package.json` sets `"type": "module"`, so
every file in the package is already ESM and the extension would add nothing.

## Adding a format

One line in [src/lib/registry/index.ts](src/lib/registry/index.ts), one directory under
`src/lib/formats/<id>/`, and one case in [test/cases.ts](test/cases.ts) — a test fails if a
registered format has no fixture, so the third step is not optional.

A descriptor holds only an id, capabilities, and a `pipeline()` that dynamic-imports. It
**must not statically import three, a loader, or wasm**: a source-text test enforces that,
and it is what keeps each parser in its own lazy chunk instead of the entry bundle.

Pick the kind by what the parser needs. `geometry` returns transferable typed arrays and
must not touch the DOM, so it can run in a worker; `scene` returns an Object3D on the main
thread and may use the DOM. Every format that needs textures, DOMParser or `window` has to
be `scene`.

## What can and cannot run in the worker

`src/lib/workers/geometryPipelines.ts` lists the worker-eligible formats, and it is separate
from the registry on purpose: the worker cannot import the registry without dragging every
scene loader in with it. A test asserts the two agree, because that duplication is exactly
the kind that drifts.

Only `geometry` pipelines qualify. Every `scene` format needs the DOM for something — `new
Image()` in USD's composer, `DOMParser` in 3MF, `window` in FBX, a live renderer for glTF's
KTX2 — so routing one into a worker fails at runtime rather than at build time.

**Transferring detaches.** `loadAsset` tries detection's candidates in order, so the input
buffers may still be needed by a later attempt; only the FINAL candidate is allowed to
transfer, and earlier ones copy. Getting this wrong produces a detached-ArrayBuffer error on
an ambiguous file and nothing at all on an unambiguous one.

**Cancellation is `terminate()`.** `STLLoader.parse` and `occt.ReadFile` are synchronous
loops with no yield point, so a signal can only be checked between phases.

## CAD dimensions are reported as authored

`AssetStats.size` is the world-space bounding box, which is what the camera frames.
`sourceSize` is the same extents expressed along the FILE's axes, and that is what the info
panel shows — a Z-up part measuring 10 × 20 × 30 on its drawing has world bounds of
10 × 30 × 20 once rotated upright.

It is derived from the world size by one rule in `sizeInSourceAxes`, deliberately not by
measuring before the wrapper is applied. Both paths must agree, and only some formats are
rotated by us: three's USDLoader rotates a Z-up stage itself, so measuring "before our
wrapper" would give a different answer for USD than for STEP describing the same part.

## The ruler renders without re-rendering

The live hover point lives in a REF, never in state, and the ghost marker and dashed line
are positioned imperatively inside a single `useFrame`. Moving the pointer across a model
therefore costs zero React renders; React only commits when a measurement is created,
deleted, cleared or selected. Putting the hover point in state would re-render the whole
scene graph at pointer rate to move one sphere.

Picking uses a manual `Raycaster`, not R3F's event system: objects join its interaction list
merely by having any handler, so an `onClick` on the model would raycast on every
`pointermove` whether or not hover was wanted.

Annotations are deliberately depth-independent (`depthTest: false`, drawn last). That is not
a workaround — CAD dimension annotations behave this way everywhere, a measurement whose far
endpoint sits inside the part is still one you need to read, and it avoids z-fighting between
a marker and the surface it rests on.

## USD stage metadata is read back off the transform

`USDComposer` applies the stage's `metersPerUnit` to the root scale and its Z-up rotation to
`rotation.x`, then discards both — neither is recorded anywhere readable. So
[src/lib/formats/usd/units.ts](src/lib/formats/usd/units.ts) recovers them from the
transform, which is coupling to three's internals: r183 did not behave this way at all.

That is why `units.test.ts` parses each stage AND independently regexes its header, then
requires the two to agree. If a three upgrade relocates the bake, every USD measurement
silently changes scale, and that canary is the only thing that would notice.

The pipeline reports `metersPerUnit: 1`, NOT the stage's own value: the contract is metres
per WORLD unit after any transform the loader already baked in, and USDLoader has already
scaled the root. Reporting the stage value would apply the conversion twice.

## Three drag-and-drop traps

Window-wide drop is where this pattern usually breaks, and every failure is silent.

**`dragleave` is not reliable.** It is swallowed when the pointer exits past the window edge
and when the element under it is removed mid-drag, so a naive boolean latches the overlay on
forever. [src/lib/dragTracker.ts](src/lib/dragTracker.ts) uses a depth counter — enter and
leave fire for every child crossed — plus a watchdog on `dragover`, which keeps firing for as
long as a drag is live. Do not remove the watchdog; it is the only thing that recovers a
swallowed leave.

**`preventDefault` must be unconditional.** Without it on both `dragover` and `drop`, the
browser NAVIGATES to the dropped file and the open model is gone with no way back. Those
handlers are bound on `document` even while loading is disabled, so it can never depend on
our own state being correct.

**Two API shapes truncate silently.** `webkitGetAsEntry()` must be called synchronously
before any await, or the items list is already empty; and `readEntries()` returns at most 100
entries per call, so it must be drained in a loop or every folder over 100 files loses the
rest without an error.

## Two camera-controls traps

Both were found by `npm run verify:viewer` after all unit tests passed, and both are the
kind of thing only an end-to-end check can see.

**`getPosition()` / `getTarget()` default `receiveEndValue` to TRUE**, returning the
DESTINATION of an in-flight transition rather than where the camera is. Always pass `false`.
Reading the default computed the depth range for a place the camera had not reached — which
clips the model for the whole flight — and flipped a view button's `aria-pressed` the moment
a move started instead of when it arrived.

**`frameloop="demand"` plus time-based damping collapses transitions after an idle.** The
clock keeps running between frames, so the first frame after a pause hands `useFrame` a
multi-second delta, and `smoothDamp` lands on the target in a single step. A move measured
at 399 ms warm became 53 ms after 1.8 s idle. `CameraRig` consumes the stale delta before
starting any tween; do not remove that call.

## Deploy

Push to `main`. [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs lint, test and
build, then publishes `dist/` via `actions/upload-pages-artifact` + `actions/deploy-pages`.
Settings → Pages → Source must be set to **GitHub Actions**.
