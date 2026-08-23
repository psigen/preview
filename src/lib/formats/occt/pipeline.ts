import { loadOcct } from "../../decoders/occtWasm";
import { countsFor } from "../../asset/fromGeometry";
import { UNITS_DECLARED, warn, type LoadWarning } from "../../asset/types";
import type { GeometryPipeline, TranscodeOutput } from "../../registry/types";
import { convertOcctResult } from "./convert";

/**
 * STEP, IGES and BREP, via Open CASCADE compiled to WebAssembly.
 *
 * A `geometry` pipeline: OCCT returns plain JSON with number arrays and touches no DOM, so
 * the whole path is transferable and worker-eligible — and, just as usefully, runs under
 * Node, which makes CAD the most end-to-end-testable format in the app.
 *
 * The unit story is the point of supporting these formats at all. A STEP file states its own
 * unit, and OCCT converts from whatever that is into the one we ask for. Asking for metres
 * means the ruler reports a real physical length from a CAD file with nothing assumed —
 * verified with a millimetre and an inch file describing the same box (docs/SPIKES.md S1).
 */
export type OcctFormat = "step" | "iges" | "brep";

/**
 * One pipeline per reader.
 *
 * A factory rather than a single shared object that inspects the input: the three formats
 * differ only in an OCCT entry point, and closing over it here means each descriptor
 * carries its own. Reading it from the input would have to come from `formatHint`, which is
 * only set when the user explicitly overrides detection — so an IGES file would have been
 * silently read as STEP.
 */
export function createOcctPipeline(format: OcctFormat): GeometryPipeline {
  return {
    kind: "geometry",

    async transcode(input, ctx) {
      const started = performance.now();

      ctx.onProgress("Loading the CAD engine", null);
      const occt = await loadOcct();
      ctx.signal.throwIfAborted();

      ctx.onProgress("Tessellating", null);
      const result = occt.ReadFile(
        format,
        new Uint8Array(input.primary.bytes),
        {
          // Metres, so metersPerUnit is 1 and the contract needs no per-format special case.
          linearUnit: "meter",
          linearDeflectionType: ctx.quality.cad.linearDeflectionType,
          linearDeflection: ctx.quality.cad.linearDeflection,
          angularDeflection: ctx.quality.cad.angularDeflection,
        },
      );
      ctx.signal.throwIfAborted();

      const scene = convertOcctResult(result, input.primary.name);
      const warnings: LoadWarning[] = [];
      if (scene.meshes.some((m) => !m.normals)) {
        warnings.push(
          warn(
            "no-normals",
            "Some faces had no normals; they were derived.",
            "info",
          ),
        );
      }

      const output: TranscodeOutput = {
        scene,
        // Already metres, because that is what we asked OCCT for. `sourceUnit` is deliberately
        // omitted: OCCT does not report what the file declared, and inventing a label would be
        // exactly the kind of guess the units contract forbids.
        units: UNITS_DECLARED(1),
        // CAD is Z-up by convention and OCCT preserves the file's own axes, so the finaliser
        // rotates once to bring it into the viewer's Y-up world.
        sourceUpAxis: "Z",
        orientation: "file",
        warnings,
        counts: countsFor(scene.meshes),
        parseMs: performance.now() - started,
      };
      return output;
    },
  };
}

export const stepPipeline = createOcctPipeline("step");
export const igesPipeline = createOcctPipeline("iges");
export const brepPipeline = createOcctPipeline("brep");
