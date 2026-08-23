import { describe, expect, it } from 'vitest';
import { length, normalize, sub, type Vec3 } from './vec3';
import {
  FIT_PADDING,
  VIEW_DIRECTIONS,
  VIEW_IDS,
  cameraPositionFor,
  distanceToFitSphere,
  matchView,
  nearFarForDistance,
  orbitLimits,
  worldPerPixel,
  type ViewId,
} from './camera';

describe('view directions', () => {
  it('covers every ViewId with a unit-length direction', () => {
    for (const id of VIEW_IDS) {
      expect(length(VIEW_DIRECTIONS[id]), id).toBeCloseTo(1, 12);
    }
  });

  it('pairs opposite views exactly', () => {
    const opposites: [ViewId, ViewId][] = [
      ['front', 'back'],
      ['left', 'right'],
      ['top', 'bottom'],
    ];
    // `+ 0` normalises the -0 that negating a 0 component produces; toEqual treats them
    // as distinct, and the sign of zero is meaningless for a direction.
    for (const [a, b] of opposites) {
      expect(VIEW_DIRECTIONS[a].map((v) => -v + 0)).toEqual([...VIEW_DIRECTIONS[b]]);
    }
  });

  it('places iso equidistant on all three axes', () => {
    const [x, y, z] = VIEW_DIRECTIONS.iso;
    expect(x).toBeCloseTo(y, 15);
    expect(y).toBeCloseTo(z, 15);
    expect(x).toBeGreaterThan(0);
  });
});

describe('distanceToFitSphere', () => {
  // The reference value that keeps Fit and the view buttons agreeing with camera-controls.
  it('matches 1 / sin(fov/2) for a unit sphere at aspect 1', () => {
    expect(distanceToFitSphere(1, 50, 1, 1)).toBeCloseTo(1 / Math.sin((25 * Math.PI) / 180), 12);
    expect(distanceToFitSphere(1, 50, 1, 1)).toBeCloseTo(2.3662, 4);
  });

  it('uses the VERTICAL fov in landscape, where it is the tighter constraint', () => {
    const vFovOnly = 1 / Math.sin((25 * Math.PI) / 180);
    expect(distanceToFitSphere(1, 50, 2, 1)).toBeCloseTo(vFovOnly, 12);
    expect(distanceToFitSphere(1, 50, 10, 1)).toBeCloseTo(vFovOnly, 12);
  });

  it('uses the HORIZONTAL fov in portrait, and so backs further off', () => {
    const landscape = distanceToFitSphere(1, 50, 2, 1);
    const portrait = distanceToFitSphere(1, 50, 0.5, 1);
    expect(portrait).toBeGreaterThan(landscape);
    const hFov = 2 * Math.atan(Math.tan((25 * Math.PI) / 180) * 0.5);
    expect(portrait).toBeCloseTo(1 / Math.sin(hFov / 2), 12);
  });

  it('scales linearly with radius and padding', () => {
    expect(distanceToFitSphere(10, 50, 1, 1)).toBeCloseTo(10 * distanceToFitSphere(1, 50, 1, 1), 9);
    expect(distanceToFitSphere(1, 50, 1, 2)).toBeCloseTo(2 * distanceToFitSphere(1, 50, 1, 1), 9);
  });

  it('leaves room around the model by default', () => {
    expect(FIT_PADDING).toBeGreaterThan(1);
    expect(distanceToFitSphere(1, 50, 1)).toBeGreaterThan(distanceToFitSphere(1, 50, 1, 1));
  });

  it('returns zero for a degenerate model rather than NaN', () => {
    expect(distanceToFitSphere(0, 50, 1)).toBe(0);
    expect(distanceToFitSphere(-5, 50, 1)).toBe(0);
  });
});

describe('nearFarForDistance', () => {
  // A 10 mm part authored in mm and a 100 m scene authored in m must behave identically.
  const SCALES: [string, number][] = [
    ['10 mm part in mm', 8],
    ['1 m part in m', 0.9],
    ['100 m scene in m', 70],
    ['micro scale', 1e-4],
    ['astronomical', 1e7],
  ];

  it.each(SCALES)('%s: stays a valid, well-conditioned frustum', (_label, r) => {
    for (const mult of [0.5, 1, 2, 5, 50, 500]) {
      const d = r * mult;
      const { near, far } = nearFarForDistance(r, d);
      expect(near, `near @${mult}x`).toBeGreaterThan(0);
      expect(far, `far @${mult}x`).toBeGreaterThan(near);
      expect(far / near, `ratio @${mult}x`).toBeLessThanOrEqual(1e4 * (1 + 1e-9));
      // The model, centred at the target, must lie inside the frustum.
      expect(far).toBeGreaterThanOrEqual(d + r);
    }
  });

  it('approaches a ratio of 1 when dollied far out', () => {
    const { near, far } = nearFarForDistance(1, 1000);
    expect(far / near).toBeLessThan(1.02);
  });

  it('floors near at far/maxRatio when dollied in close', () => {
    const { near, far } = nearFarForDistance(1, 0.001);
    expect(near).toBeGreaterThan(0);
    expect(far / near).toBeCloseTo(1e4, 0);
  });

  it('survives a zero-radius model (a single point or an empty scene)', () => {
    const { near, far } = nearFarForDistance(0, 0);
    expect(Number.isFinite(near)).toBe(true);
    expect(Number.isFinite(far)).toBe(true);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it('honours a custom ratio cap', () => {
    const { near, far } = nearFarForDistance(1, 0.001, 1e3);
    expect(far / near).toBeLessThanOrEqual(1e3 * (1 + 1e-9));
  });
});

describe('orbitLimits', () => {
  it('brackets the radius by three orders of magnitude either way', () => {
    const { minDistance, maxDistance } = orbitLimits(8);
    expect(minDistance).toBeCloseTo(0.008, 12);
    expect(maxDistance).toBeCloseTo(8000, 9);
  });

  it('never returns zero for a degenerate model', () => {
    expect(orbitLimits(0).minDistance).toBeGreaterThan(0);
  });
});

describe('cameraPositionFor', () => {
  it('offsets the target along the view direction', () => {
    expect(cameraPositionFor('front', [1, 2, 3], 10)).toEqual([1, 2, 13]);
    expect(cameraPositionFor('top', [1, 2, 3], 10)).toEqual([1, 12, 3]);
    expect(cameraPositionFor('left', [0, 0, 0], 5)).toEqual([-5, 0, 0]);
  });

  it('keeps the camera exactly `distance` from an off-origin target', () => {
    const center: Vec3 = [100, -50, 7];
    for (const id of VIEW_IDS) {
      expect(length(sub(cameraPositionFor(id, center, 42), center)), id).toBeCloseTo(42, 9);
    }
  });
});

describe('matchView', () => {
  it('recognises every standard view from its own direction', () => {
    for (const id of VIEW_IDS) {
      expect(matchView(VIEW_DIRECTIONS[id]), id).toBe(id);
    }
  });

  it('is round-trip consistent with cameraPositionFor', () => {
    const center: Vec3 = [3, -4, 5];
    for (const id of VIEW_IDS) {
      const pos = cameraPositionFor(id, center, 12);
      expect(matchView(sub(pos, center)), id).toBe(id);
    }
  });

  it('ignores magnitude', () => {
    expect(matchView([0, 1000, 0])).toBe('top');
  });

  it('accepts a direction just inside the tolerance', () => {
    const nudged = normalize([0.001, 1, 0]); // ~0.057 degrees off
    expect(matchView(nudged, 1)).toBe('top');
  });

  it('returns null for an off-axis direction', () => {
    expect(matchView(normalize([1, 0.5, 0]))).toBeNull();
    expect(matchView(normalize([0.2, 1, 0]))).toBeNull();
  });

  it('returns null rather than a wrong answer for a zero vector', () => {
    expect(matchView([0, 0, 0])).toBeNull();
  });

  it('widens with the tolerance', () => {
    const off = normalize([0.1, 1, 0]); // ~5.7 degrees
    expect(matchView(off, 1)).toBeNull();
    expect(matchView(off, 10)).toBe('top');
  });
});

describe('worldPerPixel', () => {
  // A 45-degree camera 10 units back, filling a 1000px-tall viewport, sees
  // 2*tan(22.5deg)*10 = 8.284 world units vertically, so one pixel is 1/1000 of that.
  it('matches the perspective frustum height', () => {
    const visibleHeight = 2 * Math.tan((45 * Math.PI) / 360) * 10;
    expect(worldPerPixel(10, 1000, 45)).toBeCloseTo(visibleHeight / 1000, 12);
  });

  // The property the markers actually rely on: pixel size is what stays fixed, so the
  // world size a marker needs is strictly proportional to how far away it is.
  it('scales linearly with distance', () => {
    const near = worldPerPixel(1, 800, 45);
    expect(worldPerPixel(1000, 800, 45)).toBeCloseTo(near * 1000, 9);
  });

  // Two models 1000x apart in world size are the case that motivated this: viewed from a
  // proportionally scaled distance, an identical pixel radius costs a proportional world
  // radius. A fixed world radius would be invisible on one and engulf the other.
  it('gives the same pixel size for models at wildly different scales', () => {
    const PX = 7;
    const tiny = worldPerPixel(0.05, 900, 45) * PX; // a 30 mm part, metres
    const huge = worldPerPixel(50, 900, 45) * PX; // the same part 1000x bigger
    expect(huge / tiny).toBeCloseTo(1000, 6);
  });

  it('narrows as the field of view narrows', () => {
    expect(worldPerPixel(10, 800, 20)).toBeLessThan(worldPerPixel(10, 800, 45));
  });

  it('is zero at zero distance rather than negative behind the camera', () => {
    expect(worldPerPixel(0, 800, 45)).toBe(0);
    expect(worldPerPixel(-5, 800, 45)).toBe(0);
  });

  it('never divides by a zero viewport', () => {
    expect(Number.isFinite(worldPerPixel(10, 0, 45))).toBe(true);
  });

  it('is zero at zero fov rather than NaN', () => {
    expect(worldPerPixel(10, 800, 0)).toBe(0);
  });
});
