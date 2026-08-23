import { describe, expect, it } from 'vitest';
import {
  chooseSnap,
  closestPointOnSegment,
  initialMeasureState,
  measureReducer,
  measurementDelta,
  measurementLength,
  measurementMidpoint,
  sphereAround,
  type MeasurePoint,
  type MeasureState,
  type Project,
} from './measure';
import type { Vec3 } from './vec3';

const pt = (p: Vec3, snap: MeasurePoint['snap'] = 'surface'): MeasurePoint => ({
  p,
  n: null,
  snap,
});
const on = (over: Partial<MeasureState> = {}): MeasureState => ({
  ...initialMeasureState,
  mode: 'point-to-point',
  ...over,
});

describe('measureReducer', () => {
  it('records the first pick as a draft, and the second as a measurement', () => {
    let s = on();
    s = measureReducer(s, { type: 'pick', point: pt([0, 0, 0]) });
    expect(s.draft.phase).toBe('first');
    expect(s.items).toHaveLength(0);

    s = measureReducer(s, { type: 'pick', point: pt([3, 4, 0]) });
    expect(s.draft.phase).toBe('idle');
    expect(s.items).toHaveLength(1);
    expect(measurementLength(s.items[0]!)).toBe(5);
    // The new measurement becomes the selected one, so the panel highlights what just happened.
    expect(s.selectedId).toBe(s.items[0]!.id);
  });

  /** A stray click while the tool is off must not even re-render. */
  it('returns the SAME state object for a pick while the tool is off', () => {
    const s = initialMeasureState;
    expect(measureReducer(s, { type: 'pick', point: pt([1, 1, 1]) })).toBe(s);
  });

  it('cancels a draft, and is identity when there is nothing to cancel', () => {
    let s = measureReducer(on(), { type: 'pick', point: pt([0, 0, 0]) });
    s = measureReducer(s, { type: 'cancelDraft' });
    expect(s.draft.phase).toBe('idle');
    expect(measureReducer(s, { type: 'cancelDraft' })).toBe(s);
  });

  /** The toggle governs PICKING, not visibility: the data is the user's. */
  it('keeps existing measurements when the tool is switched off', () => {
    let s = on();
    s = measureReducer(s, { type: 'pick', point: pt([0, 0, 0]) });
    s = measureReducer(s, { type: 'pick', point: pt([1, 0, 0]) });
    s = measureReducer(s, { type: 'setMode', mode: 'off' });
    expect(s.items).toHaveLength(1);
    expect(s.draft.phase).toBe('idle');
  });

  it('discards an in-progress draft when the tool is switched off', () => {
    let s = measureReducer(on(), { type: 'pick', point: pt([0, 0, 0]) });
    s = measureReducer(s, { type: 'setMode', mode: 'off' });
    expect(s.draft.phase).toBe('idle');
  });

  it('never reuses an id, even after deleting', () => {
    let s = on();
    for (const p of [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Vec3[]) {
      s = measureReducer(s, { type: 'pick', point: pt(p) });
    }
    const [first, second] = s.items;
    s = measureReducer(s, { type: 'delete', id: first!.id });
    s = measureReducer(s, { type: 'pick', point: pt([5, 0, 0]) });
    s = measureReducer(s, { type: 'pick', point: pt([6, 0, 0]) });
    const ids = s.items.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(first!.id);
    expect(ids).toContain(second!.id);
  });

  it('clears the selection when the selected measurement is deleted', () => {
    let s = on();
    s = measureReducer(s, { type: 'pick', point: pt([0, 0, 0]) });
    s = measureReducer(s, { type: 'pick', point: pt([1, 0, 0]) });
    const id = s.items[0]!.id;
    expect(s.selectedId).toBe(id);
    s = measureReducer(s, { type: 'delete', id });
    expect(s.selectedId).toBeNull();
  });

  it('leaves the selection alone when a different measurement is deleted', () => {
    let s = on();
    for (const p of [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Vec3[]) {
      s = measureReducer(s, { type: 'pick', point: pt(p) });
    }
    const keep = s.selectedId;
    s = measureReducer(s, { type: 'delete', id: s.items[0]!.id });
    expect(s.selectedId).toBe(keep);
  });

  it('is identity for deleting something that is not there', () => {
    const s = on();
    expect(measureReducer(s, { type: 'delete', id: 999 })).toBe(s);
  });

  it('clear empties the list, and is identity when already empty', () => {
    let s = on();
    s = measureReducer(s, { type: 'pick', point: pt([0, 0, 0]) });
    s = measureReducer(s, { type: 'pick', point: pt([1, 0, 0]) });
    s = measureReducer(s, { type: 'clear' });
    expect(s.items).toEqual([]);
    expect(s.selectedId).toBeNull();
    expect(measureReducer(s, { type: 'clear' })).toBe(s);
  });

  /** Measurements are world-space points, meaningless against different geometry. */
  it('reset wipes the data and disarms the tool', () => {
    let s = on({ snap: 'vertex' });
    s = measureReducer(s, { type: 'pick', point: pt([0, 0, 0]) });
    s = measureReducer(s, { type: 'pick', point: pt([1, 0, 0]) });
    s = measureReducer(s, { type: 'reset' });
    expect(s.items).toEqual([]);
    expect(s.selectedId).toBeNull();
    expect(s.draft.phase).toBe('idle');
    // Off, so the first click on the new model cannot drop an unasked-for point.
    expect(s.mode).toBe('off');
    // Snap is a hidden preference with no on-screen state, so it survives.
    expect(s.snap).toBe('vertex');
  });

  it('reset abandons a half-finished measurement rather than carrying it over', () => {
    let s = on({});
    s = measureReducer(s, { type: 'pick', point: pt([0, 0, 0]) });
    expect(s.draft.phase).toBe('first');
    s = measureReducer(s, { type: 'reset' });
    expect(s.draft.phase).toBe('idle');
    expect(s.mode).toBe('off');
  });

  it('is identity for a no-op mode, snap or selection change', () => {
    const s = on({ snap: 'auto', selectedId: null });
    expect(measureReducer(s, { type: 'setMode', mode: 'point-to-point' })).toBe(s);
    expect(measureReducer(s, { type: 'setSnap', snap: 'auto' })).toBe(s);
    expect(measureReducer(s, { type: 'select', id: null })).toBe(s);
  });
});

describe('measurement geometry', () => {
  const m = { id: 1, a: pt([1, 2, 3]), b: pt([4, 6, 3]) };

  it('measures length, midpoint and per-axis deltas', () => {
    expect(measurementLength(m)).toBe(5);
    expect(measurementMidpoint(m)).toEqual([2.5, 4, 3]);
    expect(measurementDelta(m)).toEqual([3, 4, 0]);
  });

  it('deltas are unsigned, so pick order does not change them', () => {
    expect(measurementDelta({ id: 1, a: m.b, b: m.a })).toEqual(measurementDelta(m));
  });

  it('encloses both endpoints in the zoom-to sphere', () => {
    const s = sphereAround([0, 0, 0], [10, 0, 0]);
    expect(s.center).toEqual([5, 0, 0]);
    expect(s.radius).toBeGreaterThanOrEqual(5);
  });

  it('gives a coincident pair a non-zero radius rather than a degenerate camera fit', () => {
    expect(sphereAround([1, 1, 1], [1, 1, 1]).radius).toBeGreaterThan(0);
  });
});

describe('closestPointOnSegment', () => {
  it('projects onto the interior', () => {
    expect(closestPointOnSegment([5, 3, 0], [0, 0, 0], [10, 0, 0])).toEqual([5, 0, 0]);
  });

  it('clamps at both ends', () => {
    expect(closestPointOnSegment([-7, 2, 0], [0, 0, 0], [10, 0, 0])).toEqual([0, 0, 0]);
    expect(closestPointOnSegment([99, 2, 0], [0, 0, 0], [10, 0, 0])).toEqual([10, 0, 0]);
  });

  it('handles a zero-length segment without dividing by zero', () => {
    expect(closestPointOnSegment([5, 5, 5], [2, 2, 2], [2, 2, 2])).toEqual([2, 2, 2]);
  });
});

/**
 * A fake orthographic projection: 1 world unit = 100 px, dropping Z. Injecting it is what
 * keeps snapping testable without a camera, and lets the pixel radius be exercised exactly.
 */
const project: Project = (p) => [p[0] * 100, p[1] * 100];
const TRI: [Vec3, Vec3, Vec3] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];

describe('chooseSnap', () => {
  it('takes the raw surface point when snapping is off', () => {
    const hit: Vec3 = [0.01, 0.01, 0];
    expect(chooseSnap(hit, TRI, project, 12, 'off')).toEqual({ p: hit, n: null, snap: 'surface' });
  });

  it('snaps to a corner that is within the pixel radius', () => {
    // 0.05 world units from the origin corner = 5 px, inside a 12 px radius.
    const r = chooseSnap([0.05, 0.02, 0], TRI, project, 12, 'auto');
    expect(r.snap).toBe('vertex');
    expect(r.p).toEqual([0, 0, 0]);
  });

  it('prefers a vertex over an edge when both are in range', () => {
    const r = chooseSnap([0.02, 0.01, 0], TRI, project, 20, 'auto');
    expect(r.snap).toBe('vertex');
  });

  it('snaps to an edge when no corner is close enough', () => {
    // Mid-edge, 2 px off the line but 50 px from either corner.
    const r = chooseSnap([0.5, 0.02, 0], TRI, project, 12, 'auto');
    expect(r.snap).toBe('edge');
    expect(r.p[0]).toBeCloseTo(0.5, 9);
    expect(r.p[1]).toBeCloseTo(0, 9);
  });

  it('falls back to the surface when nothing is in range', () => {
    expect(chooseSnap([0.4, 0.3, 0], TRI, project, 5, 'auto').snap).toBe('surface');
  });

  it('vertex mode never snaps to an edge', () => {
    const r = chooseSnap([0.5, 0.02, 0], TRI, project, 12, 'vertex');
    expect(r.snap).toBe('surface');
  });

  /**
   * The radius is in pixels, so the same world-space offset snaps or not depending only on
   * zoom — which is what makes it feel the same on a 1 mm fillet and a 100 m site.
   */
  it('is a screen-space radius, not a world-space one', () => {
    // Interior of the triangle, clear of every corner AND every edge: ~42 px from the
    // nearest corner and ~28 px from the nearest edge at this scale.
    const hit: Vec3 = [0.3, 0.3, 0];
    expect(chooseSnap(hit, TRI, project, 12, 'auto').snap).toBe('surface');

    // The identical world-space point, viewed zoomed out so 1 unit is 20 px instead of 100:
    // now only ~8.5 px from the corner, so it snaps. Nothing about the model changed.
    const zoomedOut: Project = (p) => [p[0] * 20, p[1] * 20];
    expect(chooseSnap(hit, TRI, zoomedOut, 12, 'auto').snap).toBe('vertex');
  });

  it('breaks ties by lowest vertex index, so the same click always snaps the same way', () => {
    // Exactly equidistant from corners 0 and 1.
    const r = chooseSnap([0.5, 0, 0], TRI, project, 100, 'auto');
    expect(r.p).toEqual([0, 0, 0]);
  });

  it('carries the surface normal through untouched', () => {
    const n: Vec3 = [0, 0, 1];
    expect(chooseSnap([0.4, 0.3, 0], TRI, project, 5, 'auto', n).n).toEqual(n);
  });
});
