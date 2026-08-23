/**
 * The measurement tool's state and geometry, as pure logic.
 *
 * Measurements are stored as two WORLD-space points and nothing else. Everything the panel
 * shows is derived, which is why a measurement survives a camera move, a display toggle and
 * a unit change for free: changing the display unit relabels every row with no
 * recomputation, because the stored value never had a unit in the first place.
 */
import { add, distance as dist, dot, length, midpoint, scale, sub, type Vec3 } from './vec3';

export type MeasureMode = 'off' | 'point-to-point';

/**
 * 'auto' prefers a vertex, then an edge, then the raw surface point.
 * 'vertex' only ever snaps to corners. 'off' always takes the surface point.
 */
export type SnapMode = 'off' | 'vertex' | 'auto';

export type SnapKind = 'surface' | 'vertex' | 'edge';

export interface MeasurePoint {
  readonly p: Vec3;
  /** Surface normal at the hit, when the geometry had one. */
  readonly n: Vec3 | null;
  readonly snap: SnapKind;
}

export interface Measurement {
  readonly id: number;
  readonly a: MeasurePoint;
  readonly b: MeasurePoint;
}

export type MeasureDraft =
  { readonly phase: 'idle' } | { readonly phase: 'first'; readonly a: MeasurePoint };

export interface MeasureState {
  readonly mode: MeasureMode;
  readonly snap: SnapMode;
  readonly draft: MeasureDraft;
  readonly items: readonly Measurement[];
  readonly nextId: number;
  readonly selectedId: number | null;
}

export type MeasureAction =
  | { type: 'setMode'; mode: MeasureMode }
  | { type: 'setSnap'; snap: SnapMode }
  | { type: 'pick'; point: MeasurePoint }
  | { type: 'cancelDraft' }
  | { type: 'select'; id: number | null }
  | { type: 'delete'; id: number }
  | { type: 'clear' }
  | { type: 'reset' };

export const initialMeasureState: MeasureState = Object.freeze({
  mode: 'off' as const,
  snap: 'auto' as const,
  draft: { phase: 'idle' as const },
  items: [],
  nextId: 1,
  selectedId: null,
});

export function measureReducer(state: MeasureState, action: MeasureAction): MeasureState {
  switch (action.type) {
    case 'setMode': {
      if (action.mode === state.mode) return state;
      // Turning the tool off KEEPS the measurements: they are user-authored data, and the
      // toggle governs picking, not visibility.
      return { ...state, mode: action.mode, draft: { phase: 'idle' } };
    }

    case 'setSnap':
      return action.snap === state.snap ? state : { ...state, snap: action.snap };

    case 'pick': {
      // Identity, not a new object: a stray click while the tool is off must not re-render.
      if (state.mode === 'off') return state;
      if (state.draft.phase === 'idle') {
        return { ...state, draft: { phase: 'first', a: action.point } };
      }
      const measurement: Measurement = { id: state.nextId, a: state.draft.a, b: action.point };
      return {
        ...state,
        draft: { phase: 'idle' },
        items: [...state.items, measurement],
        nextId: state.nextId + 1,
        selectedId: measurement.id,
      };
    }

    case 'cancelDraft':
      return state.draft.phase === 'idle' ? state : { ...state, draft: { phase: 'idle' } };

    case 'select':
      return action.id === state.selectedId ? state : { ...state, selectedId: action.id };

    case 'delete': {
      if (!state.items.some((m) => m.id === action.id)) return state;
      return {
        ...state,
        items: state.items.filter((m) => m.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    }

    case 'clear':
      return state.items.length === 0 && state.selectedId === null
        ? state
        : { ...state, items: [], selectedId: null, draft: { phase: 'idle' } };

    case 'reset':
      // A new model starts with the tool OFF. Leaving it armed means the first click on
      // the model the user just opened drops a measurement point they did not ask for.
      // `snap` survives: it is a hidden preference with no on-screen state of its own.
      return { ...initialMeasureState, snap: state.snap };

    default:
      return state;
  }
}

/* ------------------------------------------------------------------ geometry */

export const measurementLength = (m: Measurement): number => dist(m.a.p, m.b.p);
export const measurementMidpoint = (m: Measurement): Vec3 => midpoint(m.a.p, m.b.p);

/** Axis-aligned component deltas, for the expanded row in the panel. */
export const measurementDelta = (m: Measurement): Vec3 => [
  Math.abs(m.b.p[0] - m.a.p[0]),
  Math.abs(m.b.p[1] - m.a.p[1]),
  Math.abs(m.b.p[2] - m.a.p[2]),
];

/** Closest point on segment ab to p, clamped to the segment. */
export function closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const lengthSq = dot(ab, ab);
  if (lengthSq === 0) return a; // degenerate segment
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / lengthSq));
  return add(a, scale(ab, t));
}

/** A sphere enclosing both endpoints, for "zoom to this measurement". */
export function sphereAround(a: Vec3, b: Vec3, pad = 1.6): { center: Vec3; radius: number } {
  const center = midpoint(a, b);
  return { center, radius: Math.max(length(sub(b, a)) / 2, 1e-9) * pad };
}

export type Project = (p: Vec3) => readonly [number, number];

const pixelGap = (project: Project, a: Vec3, b: Vec3): number => {
  const [ax, ay] = project(a);
  const [bx, by] = project(b);
  return Math.hypot(ax - bx, ay - by);
};

/**
 * Decide what a click actually landed on.
 *
 * Triangle-local by design: a global nearest-vertex query would need a spatial index over
 * every vertex, and this matches what the user perceives anyway — "I clicked near that
 * corner". The candidate set is the three corners and three edges of the hit triangle.
 *
 * The radius is in SCREEN PIXELS, not world units, so snapping feels identical zoomed into
 * a 1 mm fillet and zoomed out on a 100 m site. That is why the projection is injected: it
 * keeps this function pure and testable with a fake camera.
 */
export function chooseSnap(
  hit: Vec3,
  triangle: readonly [Vec3, Vec3, Vec3],
  project: Project,
  radiusPx: number,
  mode: SnapMode,
  normal: Vec3 | null = null,
): MeasurePoint {
  if (mode === 'off') return { p: hit, n: normal, snap: 'surface' };

  // Vertices first, and ties broken by lowest index so the same click always snaps to the
  // same corner — determinism matters here because it is user-visible.
  let bestVertex: { p: Vec3; gap: number } | null = null;
  for (const corner of triangle) {
    const gap = pixelGap(project, hit, corner);
    if (gap <= radiusPx && (bestVertex === null || gap < bestVertex.gap)) {
      bestVertex = { p: corner, gap };
    }
  }
  if (bestVertex) return { p: bestVertex.p, n: normal, snap: 'vertex' };

  if (mode === 'vertex') return { p: hit, n: normal, snap: 'surface' };

  let bestEdge: { p: Vec3; gap: number } | null = null;
  const edges: [Vec3, Vec3][] = [
    [triangle[0], triangle[1]],
    [triangle[1], triangle[2]],
    [triangle[2], triangle[0]],
  ];
  for (const [a, b] of edges) {
    const candidate = closestPointOnSegment(hit, a, b);
    const gap = pixelGap(project, hit, candidate);
    if (gap <= radiusPx && (bestEdge === null || gap < bestEdge.gap)) {
      bestEdge = { p: candidate, gap };
    }
  }
  if (bestEdge) return { p: bestEdge.p, n: normal, snap: 'edge' };

  return { p: hit, n: normal, snap: 'surface' };
}
