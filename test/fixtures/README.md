# Committed fixtures

Everything here is a file that cannot be generated in-process. Everything that _can_ be is
built in `test/gen/` instead, so it cannot go stale.

## `box-mm.step`, `box-inch.step`

The canonical 10 × 20 × 30 mm box as a STEP AP203 solid: 6 planar faces, 12 edges, 8
vertices, one `MANIFOLD_SOLID_BREP`.

Derived by taking a minimal AP203 block and rewriting its 26 `CARTESIAN_POINT` coordinates —
hand-writing a B-rep from nothing is a poor use of effort, and a malformed one fails in ways
that are hard to read. Only the points changed: `DIRECTION` entities are unit vectors and all
12 `VECTOR` magnitudes are `1.`, so nothing else carries a length.

The pair exists to prove ONE thing that nothing else can: `box-mm.step` declares
`SI_UNIT(.MILLI.,.METRE.)` and `box-inch.step` declares `CONVERSION_BASED_UNIT('INCH')`, and
they describe the same physical object. If OCCT ever stops converting from a file's declared
unit, the two stop agreeing and the format suite fails. See docs/SPIKES.md S1.

Both are plain text, so they diff and review like source.

## `box-mm.igs`

The same box as six untrimmed bilinear NURBS patches (IGES entity 128), declaring
millimetres via global parameter 14. Flat patches need no trimming, which avoids the
142/144 trimmed-surface machinery entirely — six faces, two triangles each, twelve in total.

Generated rather than sourced, so nothing here depends on a third party's licence.

Worth knowing if you ever edit it: every Hollerith string in the global section carries its
own length prefix, and a wrong count desyncs everything after it. The symptom is not a parse
error — the file loads cleanly with the WRONG UNITS and a face silently missing. Both
disappeared the moment the counts were computed instead of hand-written.
