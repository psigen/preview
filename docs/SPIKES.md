# Stage 0 — assumption spikes

Several load-bearing facts in the plan were source-read but never executed. These spikes ran each one
against real code before any `src/` was written. **Do not re-derive these** — amend this file instead.

Environment: node v24.15.0 (CI pins 22), three 0.185.1, occt-import-js 0.0.23, vite 8.2.2,
React 19.2.8, @react-three/fiber 9.7.0, @react-three/drei 10.7.8, three-mesh-bvh 0.8.3.
Browser checks ran in headless Chrome over CDP.

| #   | Question                                                            | Verdict                                       |
| --- | ------------------------------------------------------------------- | --------------------------------------------- |
| S1  | Does OCCT convert from a file's _declared_ unit?                    | **PASS** (doubly confirmed)                   |
| S2  | Does `occtimportjs({wasmBinary})` work in a Vite **module worker**? | **PASS**                                      |
| S3  | Does OCCT tessellate a surface-only IGES?                           | **PASS, with a caveat**                       |
| S4  | Do three's loaders `parse()` in plain Node?                         | **PASS 12/12**                                |
| S5  | Does `metersPerUnit` read back for USDC crate?                      | **PARTIAL** — USDA proven, crate untested     |
| S6  | Does `GLTFExporter` emit a GLB in Node?                             | **MOOT** — fallback adopted, and it is better |
| S7  | Does the pinned version matrix install and render?                  | **PASS**                                      |
| S8  | Initial bundle size                                                 | **PASS** — 307.7 kB gzip vs an 800 kB budget  |

---

## S1 — OCCT declared-unit conversion ✅ PASS

The single highest-stakes assumption: the whole real-units CAD feature rests on it.

Two STEP files were authored describing the **same physical 10 × 20 × 30 mm box**, one declaring
`SI_UNIT(.MILLI.,.METRE.)` and one declaring `CONVERSION_BASED_UNIT('INCH')`. Read with
`{ linearUnit: 'meter' }`:

```
box-mm.step    size = 1.000000e-2  2.000000e-2  3.000000e-2   tris 12
box-inch.step  size = 1.000000e-2  2.000000e-2  3.000000e-2   tris 12
-> the two files agree with each other : YES
-> both match the true physical size   : YES
```

Independently corroborated against upstream occt-import-js's own `test/testfiles/cube-units/`, which
holds the same 1 m cube declared three ways. All three read back as exactly `[1, 1, 1]` m:

| file           | declared unit                   | as metres   |
| -------------- | ------------------------------- | ----------- |
| `cube-in.step` | `CONVERSION_BASED_UNIT('INCH')` | `[1, 1, 1]` |
| `cube-m.step`  | `SI_UNIT($,.METRE.)`            | `[1, 1, 1]` |
| `cube-mm.step` | `SI_UNIT(.MILLI.,.METRE.)`      | `[1, 1, 1]` |

`linearUnit` also correctly retargets the output unit (`millimeter → [10,20,30]`,
`centimeter → [1,2,3]`, `meter → [0.01,0.02,0.03]`, `inch → [0.3937,…]`, `foot → [0.0328,…]`), the
default with `params = null` is millimetre, and the origin is preserved at `(0,0,0)` — nothing is
recentred.

**Decisions confirmed:** request `linearUnit: 'meter'` and report `metersPerUnit: 1`. No manual
`SI_UNIT` / `CONVERSION_BASED_UNIT` header parsing is needed for correctness.

**Calibration:** the inch path accumulates ~6e-15 relative error
(`0.037416573867745884` vs `0.03741657386773942`). The cross-format diagonal invariant must therefore
use a tolerance of ≥1e-12 absolute — never exact equality. `toBeCloseTo(…, 9)` covers it.

**Optional follow-up:** OCCT does not expose the _original_ declared unit, so an info-panel line like
"authored in millimetres" would need our own header regex. Cosmetic only; cannot affect correctness.

## S2 — occt-import-js in a Vite module worker ✅ PASS

The plan's premise was that all three emscripten environment flags are false in a module worker
(`ENVIRONMENT_IS_WEB = typeof window == "object"`,
`ENVIRONMENT_IS_WORKER = typeof importScripts == "function"`, `ENVIRONMENT_IS_NODE`), leaving
`readAsync` unassigned so the wasm fetch throws — and that passing `wasmBinary` short-circuits it via
`getBinarySync`.

Verified end-to-end in headless Chrome against a real Vite 8 build: a module worker
`import occtFactory from 'occt-import-js'`, `await occtFactory({ wasmBinary })`, parse a STEP, transfer
typed arrays back, build a `BufferGeometry`, render through R3F.

```
OK  tris=12  size=[0.0100, 0.0200, 0.0300] m  166ms
```

**Decisions confirmed:** `wasmBinary` injection is the contract. No `locateFile`, no `BASE_URL` logic
inside the worker, no classic-worker fallback needed. Only the `.wasm` needs staging in `public/`; the
97 kB UMD glue bundles into the worker chunk (59 kB minified).

**Two build-time warnings, both benign but worth silencing:** Vite externalises `path` and `crypto`,
which occt's glue references only on its Node branch. That branch is never taken when `wasmBinary` is
supplied — confirmed by the successful browser run — but the warnings should be suppressed with an
alias to an empty module so a real warning is never lost in the noise. (`fs` is already handled by the
package's own `"browser": { "fs": false }` field.)

Also seen: `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` — emitted
from within drei/camera-controls, not our code. Cosmetic.

## S3 — surface-only IGES ✅ PASS, with a caveat

| file                                      | result                                                          |
| ----------------------------------------- | --------------------------------------------------------------- |
| `surf114.igs` (NURBS surfaces)            | `success=true`, **4 meshes, 21,462 triangles**, normals present |
| `curve_geom_plate.igs` (curves/wireframe) | `success=true`, **0 meshes, 0 triangles**                       |

Surface-only IGES tessellates fine, so IGES stays in scope. But **`success: true` does not imply
geometry** — a curves-only file parses "successfully" and yields nothing.

**Decisions confirmed:** the occt plugin must check mesh count, not just `success`, and raise the
planned "No renderable geometry found in this file" error. That path is real and reachable, not
hypothetical.

**Also found:** OCCT writes `Total number of loaded entities N.` to stdout. Pass
`print`/`printErr` no-ops to the module factory so it does not pollute the app console or test output.

## S4 — three's loaders in plain Node ✅ PASS 12/12

Validates the entire headless test strategy. Every fixture is the canonical box; the abstract diagonal
is `37.416574`.

```
PASS  stl-ascii              meshes=1 tris=12 n=y size=[10, 20, 30]       diag=37.416574
PASS  stl-binary             meshes=1 tris=12 n=y size=[10, 20, 30]       diag=37.416574
PASS  stl-bin-solid-header   meshes=1 tris=12 n=y size=[10, 20, 30]       diag=37.416574
PASS  ply-ascii              meshes=1 tris=12 n=n size=[10, 20, 30]       diag=37.416574
PASS  ply-bin-le             meshes=1 tris=12 n=n size=[10, 20, 30]       diag=37.416574
PASS  ply-bin-be             meshes=1 tris=12 n=n size=[10, 20, 30]       diag=37.416574
PASS  obj-plain              meshes=1 tris=12 n=y size=[10, 20, 30]       diag=37.416574
PASS  obj-with-mtl           meshes=1 tris=12 n=y size=[10, 20, 30]       diag=37.416574  kd=#cc5933
PASS  glb                    meshes=1 tris=12 n=y size=[10, 20, 30]       diag=37.416574
PASS  usda-mpu1-Y            meshes=1 tris=12 n=y size=[0.01, 0.02, 0.03] diag=0.037417
PASS  usda-mpu0.01-Y         meshes=1 tris=12 n=y size=[0.01, 0.02, 0.03] diag=0.037417
PASS  usda-mpu0.001-Z        meshes=1 tris=12 n=y size=[0.01, 0.02, 0.03] diag=0.037417
```

Findings beyond the pass/fail:

- **PLY big-endian works.** The loader only names `binary_little_endian` and passes the negation into
  `DataView.getFloat32(at, littleEndian)`, so BE falls through correctly.
- **OBJ+MTL parses materials headless** — `Kd 0.80 0.35 0.20` arrives as `#cc5933`. The
  `manager.getHandler` stub the plan reserved is not needed for untextured MTL.
- **USD applies `metersPerUnit` at r185.** All three USDA variants land at world size
  `[0.01, 0.02, 0.03]`, i.e. metres. (This contradicts an r183-based reading; r185 is what ships.)
- **Z-up handling is correct.** The Z-up file, authored with Y/Z extents swapped (file-space
  `10 × 30 × 20`), comes out `[0.01, 0.02, 0.03]` after the −π/2 rotation, with a diagonal identical to
  the Y-up files. The cross-format invariant works, and the fixture design is right.
- **PLY carries no normals**, confirming `prepare.ts` must `computeVertexNormals()`.

## S5 — USDC crate `metersPerUnit` ⚠️ PARTIAL

`USDCParser` does not special-case `metersPerUnit`/`upAxis`, and does not need to: `USDComposer` reads
them generically off `specsByPath['/'].fields`, the same path both parsers populate. That is a
structural argument, not a measurement.

No small crate fixture was found — three.js's `saeukkang.usdz` turned out to contain a **`.usda`**, not
a crate.

**Residual risk, accepted:** USDA is proven across the full 3 × 2 unit/axis matrix, and it shares the
composer path with crate. If a crate fixture with a known non-unit `metersPerUnit` becomes available,
add it to the matrix. Until then USDC is covered for geometry only.

**Bonus finding — a declared gap confirmed.** Parsing the textured `saeukkang.usdz` in plain Node
throws `ReferenceError: Image is not defined`, synchronously, exactly as predicted. Untextured USD
fixtures are the right mitigation. **Possible upgrade:** jsdom _does_ provide `Image`, so textured USD
may be testable at the `dom` tier rather than browser-only — worth 10 minutes during implementation.

## S6 — GLTFExporter in Node ⚪ MOOT (fallback adopted)

Node has neither `document` nor `OffscreenCanvas`, so `getCanvas()` would throw — but its three call
sites (lines 982, 1071, 1451) are all texture paths, unreachable for untextured geometry.

Rather than depend on that reasoning, the planned fallback was adopted directly: the glTF/GLB fixtures
are **hand-written JSON + BIN** (~60 lines). They round-trip through `GLTFLoader` in Node (S4, `glb`
row). This removes a dependency on exporter internals and makes the fixture bytes fully deterministic,
which the plan already noted was "mildly preferable anyway".

## S7 — version matrix ✅ PASS

83 packages, clean install, renders in headless Chrome. The dedupe question that drove the
`three-mesh-bvh` pin resolves correctly:

```
├─┬ @react-three/drei@10.7.8
│ └── three-mesh-bvh@0.8.3 deduped
└── three-mesh-bvh@0.8.3
```

One copy of `three-mesh-bvh`, one copy of `three@0.185.1`, `camera-controls@3.1.2` via drei.

## S8 — bundle size ✅ PASS

A build with React + R3F + drei + three eagerly imported, no code splitting:

```
dist/assets/occt.worker-*.js     59.15 kB
dist/assets/index-*.js        1,127.32 kB │ gzip: 307.72 kB
```

**307.7 kB gzip against an 800 kB budget.** The 7.6 MB occt wasm stays in `public/` and is fetched only
when a CAD file is opened. Headroom is ample provided the format plugins stay behind dynamic imports.
