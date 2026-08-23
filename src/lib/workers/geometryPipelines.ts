import type { FormatId } from '../format-id';
import type { GeometryPipeline } from '../registry/types';

/**
 * Which formats the worker can run, and how to reach them.
 *
 * Only `geometry` pipelines appear here, and that is the point: every `scene` format needs
 * the DOM for something — `new Image()` in USD's composer, `DOMParser` in 3MF, `window` in
 * FBX, a live renderer for glTF's KTX2 — so routing one into a worker would fail at runtime
 * rather than at build time.
 *
 * A test asserts this map matches the registry, because the two are separate on purpose: the
 * worker cannot import the registry without dragging every scene loader in with it.
 */
export const GEOMETRY_PIPELINES: Partial<Record<FormatId, () => Promise<GeometryPipeline>>> = {
  stl: () => import('../formats/stl/pipeline').then((m) => m.stlPipeline),
  ply: () => import('../formats/ply/pipeline').then((m) => m.plyPipeline),
  step: () => import('../formats/occt/pipeline').then((m) => m.stepPipeline),
  iges: () => import('../formats/occt/pipeline').then((m) => m.igesPipeline),
};

/** CAD is the only family whose engine must be handed its wasm from outside. */
export const NEEDS_OCCT: ReadonlySet<FormatId> = new Set<FormatId>(['step', 'iges', 'brep']);

export function isWorkerEligible(format: FormatId): boolean {
  return format in GEOMETRY_PIPELINES;
}
