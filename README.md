# preview

A **100% client-side** web app to view and measure **3D mesh and CAD files** in the browser.
Drop in a model, orbit it, snap to standard views, and measure between two points on its surface
— with **real units** when the file declares them. All parsing and CAD tessellation happens in
your browser via WebAssembly. **Your model is never uploaded to any server run by this app.**

- 📦 Meshes: **USD** (usda / usdc / usdz), **glTF / GLB**, **STL**, **PLY**, OBJ, 3MF, FBX
- 📐 CAD: **STEP**, **IGES**, BREP — tessellated in-browser via Open CASCADE
- 📁 Drag in a single file, several files at once, a whole folder, or a `.zip`
- 📏 Two-point surface ruler reporting mm / cm / m / in / ft, honestly labelled when a format
  declares no units at all
- 🎥 Orbit / pan / zoom plus Top, Bottom, Front, Back, Left, Right, Iso and Fit
- 🔒 No backend, no uploads, no analytics — and no network at all once the page has loaded
- 🚀 One-click deploy to GitHub Pages

## Status

Early. The architecture is being built stage by stage on top of the assumptions verified in
[docs/SPIKES.md](docs/SPIKES.md). What exists today is the scaffold, the wasm staging pipeline
and the format-detection library; the viewer, loader plugins and ruler are still to land.

| Area | State |
| --- | --- |
| Toolchain, CI, GitHub Pages deploy, decoder staging | done |
| Format detection (`src/lib/detect/`) | done |
| Units, camera and budget maths (`src/lib/`) | done |
| Asset contract: payload, orientation, stats, bounds, disposal | done |
| Viewer: camera, standard views, lighting | done |
| Format registry, STL and PLY loading, bundled samples | done |
| Drag-and-drop, folder drop, in-place replacement | done |
| Remaining formats, measurement ruler | not yet |

371 unit tests pass headless, plus a 28-check end-to-end verification
(`npm run verify:viewer`) that drives the real UI in headless Chrome, including
a calibrated geometry-leak check.

The feature list above describes the target. Nothing in it is wired up yet.

## Quick start

```bash
npm install        # also stages the Draco / Basis / OCCT decoders into public/vendor
npm run dev        # http://localhost:5173
```

Using [Nix](https://nixos.org/)? A flake provides the Node toolchain — drop into a dev shell
first, then run the npm commands inside it:

```bash
nix develop        # shell with Node 22 (pinned via flake.lock)
# or, one-off:  nix shell nixpkgs#nodejs_22
```

To verify a production build locally:

```bash
npm run build
npm run preview
```

Running the checks:

```bash
npm test             # vitest, the CI gate — every format's parse path, headless
npm run test:browser # optional tier: Draco, KTX2, real workers, WebGL
npm run lint         # eslint + the no-network guard
npm run verify:viewer # end-to-end camera checks in headless Chrome (needs a built dist/)
```

## Supported formats

| Format | Extensions | Loader | Units |
| --- | --- | --- | --- |
| OpenUSD | `.usd` `.usda` `.usdc` `.usdz` | three `USDLoader` | declared (`metersPerUnit`) |
| glTF 2.0 | `.gltf` `.glb` | three `GLTFLoader` + Draco / KTX2 / meshopt | metres, per spec |
| STEP | `.step` `.stp` | `occt-import-js` (wasm) | declared, converted by OCCT |
| IGES | `.iges` `.igs` | `occt-import-js` (wasm) | declared, converted by OCCT |
| BREP | `.brep` `.brp` | `occt-import-js` (wasm) | declared |
| 3MF | `.3mf` | three `3MFLoader` | declared (`unit` attribute) |
| STL | `.stl` | three `STLLoader` — **working** | none — abstract |
| PLY | `.ply` | three `PLYLoader` — **working** | none — abstract |
| OBJ | `.obj` (+ `.mtl`) | three `OBJLoader` | none — abstract |
| FBX | `.fbx` | three `FBXLoader` | none — abstract |

Formats are identified by **magic bytes first**, with the filename only as a tie-breaker, so a
renamed download still opens. Adding a format is one entry in the registry plus a plugin
directory — see [CLAUDE.md](CLAUDE.md).

## How it works

| Concern | Approach |
| --- | --- |
| Mesh parsing | three.js loaders, dynamically imported so nothing unused is in the bundle |
| CAD tessellation | `occt-import-js` (Open CASCADE → WebAssembly), in a Web Worker |
| Sidecar files | An in-memory companion map hooked into `LoadingManager.setURLModifier` |
| Rendering | react-three-fiber + three.js, `frameloop="demand"` so an idle viewer costs nothing |
| Lighting | Procedural `RoomEnvironment` + `PMREMGenerator` — no HDRI download |
| Picking | A manual raycaster with a `three-mesh-bvh` acceleration structure |

Heavy formats go through a **transcode phase**: bytes in, transferable typed arrays out. That
runs in a worker and keeps the UI responsive on a large STL or a slow STEP tessellation. Formats
that need the DOM for textures — glTF, USD, OBJ, 3MF, FBX — load on the main thread instead.

### Units and measurement

The ruler reports a real length whenever the file says what its numbers mean, and refuses to
invent one when it doesn't:

| Source says | Ruler shows |
| --- | --- |
| USD `metersPerUnit`, glTF metres, a STEP/IGES unit, a 3MF `unit` | `124.53 mm` — real, converted |
| Nothing (STL, PLY, OBJ, FBX) | `37.417 u` — abstract, with no assumed scale |

A model is never rescaled to fit the view; the camera fits to the model instead. Up-axis
correction is a rotation, which cannot change a distance, so a measurement reads the same
whichever way the model is oriented.

### No network at runtime

Once loaded, the app makes no requests. Fonts are system fonts, lighting is procedural, and every
decoder is served from the same origin. This is enforced mechanically — an eslint rule bans the
drei APIs that reach for a CDN, and `scripts/check-no-network.mjs
scripts/verify-viewer.mjs   # end-to-end camera checks driven through CDP` fails the build on a stray URL
in `src/`.

The Open CASCADE wasm is 7.6 MB and lives in `public/vendor/`, so it is fetched **only** the first
time you open a CAD file, and never for a mesh.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main` — [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs lint,
   tests and the build, then deploys. Your app will be at
   `https://<username>.github.io/<repo>/`.

`base` is set to `./` so it works under a project path or a custom domain with no edits, and a
`.nojekyll` file is included so the `vendor/` assets are served intact.

To build without CAD support — and therefore with no LGPL artifacts at all — set
`VITE_ENABLE_CAD=0`.

## Notes & limits

- Parsing holds the file and its decoded geometry in memory. Very large models (roughly past a
  few million triangles) will be slow to pick against, and a several-hundred-megabyte file may
  exhaust the tab; the app warns before it starts on one.
- A `.gltf` that references an external `.bin` or textures needs those files too — drop the whole
  folder, or use a self-contained `.glb`.
- IGES files that contain only curves or wireframe carry no surfaces to tessellate, and will
  report that no renderable geometry was found.
- Draco-compressed geometry and KTX2 textures work in the browser but cannot be covered by the
  headless test suite; see [docs/SPIKES.md](docs/SPIKES.md).

## Project layout

```
src/
  lib/detect/          # magic-byte format detection — pure, no three, no DOM, own test suite
  lib/asset/           # the contract every format plugin fulfils
    types.ts           #   UnitInfo, UpAxis, LoadedModel, AssetStats, warnings
    payload.ts         #   the transferable intermediate + buildScene()
    orient.ts          #   up-axis normalisation and worldFromFile
    stats.ts           #   world-space counting and measurement
    dispose.ts         #   GPU resource release
  lib/load/            # finalize() and, for now, a stub loader
  lib/units.ts         # unit table, conversion, and the display-precision rule
  lib/camera.ts        # standard views, fit distance, scale-relative depth range
  lib/bounds.ts        # world bounds, union-of-spheres, grid sizing
  lib/vec3.ts          # tuple vector maths shared by camera, bounds and measurement
  lib/limits.ts        # size/complexity budgets and the degradation they drive
  lib/registry/        # the format registry and the plugin contract
  lib/formats/         # one directory per format: a tiny descriptor + a lazy pipeline
  lib/samples/         # the canonical box, and the bundled sample models built from it
  lib/dnd.ts           # primary-file election and path normalisation for a drop
  lib/dragTracker.ts   # the enter/leave counter and stale-drag watchdog, as pure logic
  lib/dropEntries.ts   # directory-aware drop reading (drains readEntries properly)
  lib/format-id.ts     # the shared format vocabulary
  components/          # Viewer, CameraRig, SceneEnvironment, ModelRoot, ViewToolbar
  hooks/               # useRoomEnvironment, usePrefersReducedMotion
  App.tsx, main.tsx    # app shell and hash routing
  styles.css           # one global stylesheet, tokens shared with videoclip
test/gen/              # in-memory fixture writers for the canonical 10x20x30 mm box
scripts/copy-wasm.mjs  # stages Draco / Basis / OCCT into public/vendor on install
scripts/check-no-network.mjs
scripts/verify-viewer.mjs   # end-to-end camera checks driven through CDP
docs/SPIKES.md         # what was verified before the architecture was committed to
```

## Licences

preview itself is MIT — see [LICENSE.md](LICENSE.md).

CAD import uses [occt-import-js](https://github.com/kovacsv/occt-import-js), which is
**LGPL-2.1** and bundles Open CASCADE Technology. Its wasm is kept as a separate, unmodified,
replaceable file under `public/vendor/occt/` and both licence texts are served alongside it, so a
recipient can relink a rebuilt copy. Building with `VITE_ENABLE_CAD=0` omits it entirely.
