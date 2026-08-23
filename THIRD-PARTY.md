# Third-party components

preview itself is MIT licensed (see [LICENSE.md](LICENSE.md)). Everything it depends on is
MIT too, with one exception.

## occt-import-js — LGPL-2.1

CAD import (STEP, IGES) uses [occt-import-js](https://github.com/kovacsv/occt-import-js),
which is LGPL-2.1 and statically links Open CASCADE Technology (LGPL-2.1 with the Open
CASCADE Exception). Its WebAssembly build is therefore a derived work of OCCT.

LGPL's substantive requirement for an application that is not itself copyleft is that a
recipient can **relink** against a modified copy of the library, plus licence text and
notice. This project satisfies that by construction:

- **The wasm is never bundled.** It is staged verbatim as a separate, unmodified file at a
  stable path, `vendor/occt/occt-import-js.wasm`, and fetched at runtime. Anyone can drop in
  their own rebuilt binary and the app will use it. It is never base64-inlined, and Rollup
  never rewrites it.
- **Both licence texts ship alongside it**, at `vendor/occt/license.occt.txt` and
  `vendor/occt/license.occt-import-js.txt`, served from the same directory.
- **It is a dependency, not vendored source.** Our code calls its published API, which makes
  preview "a work that uses the Library" under LGPL §5 rather than a derivative of it.
- **It can be removed entirely.** Building with `VITE_ENABLE_CAD=0` omits the STEP and IGES
  registrations and skips the vendor staging, producing a build with no LGPL artifacts at
  all and taking `public/vendor/` from 8.3 MB to 844 kB.

This is an engineering analysis, not legal advice. Get a lawyer's read before any commercial
deployment.

## MIT dependencies

| Component                                                         | Used for                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| [three.js](https://github.com/mrdoob/three.js)                    | rendering, and the STL, PLY, glTF and USD loaders       |
| [@react-three/fiber](https://github.com/pmndrs/react-three-fiber) | the React renderer for three                            |
| [@react-three/drei](https://github.com/pmndrs/drei)               | `CameraControls`, `Line`, `Html`, the orientation gizmo |
| [camera-controls](https://github.com/yomotsu/camera-controls)     | the underlying camera implementation                    |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)     | accelerated picking for the measurement tool            |
| [React](https://github.com/facebook/react)                        | the application framework                               |

Decoder binaries staged into `public/vendor/` — Draco and Basis/KTX2 — are redistributed
unmodified from the three.js package and carry Apache-2.0 licences, recorded in the READMEs
that accompany them upstream.
