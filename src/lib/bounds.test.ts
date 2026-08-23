import { describe, expect, it } from 'vitest';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three';
import {
  boxCenter,
  boxSize,
  chooseGridSteps,
  computeBounds,
  groundY,
  isFiniteBox,
  mergeSpheres,
  niceStep,
  sphereRadiusFromBox,
  unionSphere,
  type BoundingSphere,
} from './bounds';
import type { Vec3 } from './vec3';

describe('box maths', () => {
  it('computes size and centre', () => {
    expect(boxSize([0, 0, 0], [10, 20, 30])).toEqual([10, 20, 30]);
    expect(boxCenter([0, 0, 0], [10, 20, 30])).toEqual([5, 10, 15]);
    expect(boxCenter([-4, -4, -4], [4, 4, 4])).toEqual([0, 0, 0]);
  });

  it('circumscribes a box with half its diagonal', () => {
    expect(sphereRadiusFromBox([0, 0, 0], [2, 0, 0])).toBe(1);
    expect(sphereRadiusFromBox([0, 0, 0], [10, 20, 30])).toBeCloseTo(
      Math.hypot(10, 20, 30) / 2,
      12,
    );
  });

  it('reports a zero-size box as finite with radius zero', () => {
    expect(isFiniteBox([1, 1, 1], [1, 1, 1])).toBe(true);
    expect(sphereRadiusFromBox([1, 1, 1], [1, 1, 1])).toBe(0);
  });

  it('rejects non-finite and inverted boxes', () => {
    expect(isFiniteBox([0, 0, 0], [NaN, 1, 1])).toBe(false);
    expect(isFiniteBox([0, 0, 0], [Infinity, 1, 1])).toBe(false);
    expect(isFiniteBox([5, 0, 0], [1, 1, 1])).toBe(false);
  });
});

describe('sphere union', () => {
  it('keeps the containing sphere when one swallows the other', () => {
    const big: BoundingSphere = { center: [0, 0, 0], radius: 10 };
    const small: BoundingSphere = { center: [1, 0, 0], radius: 2 };
    expect(mergeSpheres(big, small)).toBe(big);
    expect(mergeSpheres(small, big)).toBe(big);
  });

  it('grows along the axis between two disjoint spheres', () => {
    const merged = mergeSpheres(
      { center: [-10, 0, 0], radius: 1 },
      { center: [10, 0, 0], radius: 1 },
    );
    expect(merged.radius).toBeCloseTo(11, 9);
    expect(merged.center[0]).toBeCloseTo(0, 9);
  });

  it('handles concentric spheres without dividing by zero', () => {
    const merged = mergeSpheres({ center: [1, 2, 3], radius: 1 }, { center: [1, 2, 3], radius: 4 });
    expect(merged.radius).toBe(4);
    expect(Number.isFinite(merged.center[0])).toBe(true);
  });

  it('contains every input sphere', () => {
    const spheres: BoundingSphere[] = [
      { center: [0, 0, 0], radius: 1 },
      { center: [5, 0, 0], radius: 2 },
      { center: [0, -8, 3], radius: 0.5 },
    ];
    const u = unionSphere(spheres);
    for (const s of spheres) {
      const d = Math.hypot(...(s.center.map((c, i) => c - u.center[i]!) as unknown as number[]));
      expect(d + s.radius).toBeLessThanOrEqual(u.radius + 1e-9);
    }
  });

  it('returns a degenerate sphere for no input', () => {
    expect(unionSphere([])).toEqual({ center: [0, 0, 0], radius: 0 });
  });
});

describe('niceStep and grid sizing', () => {
  it.each([
    [0.037, 0.02],
    [370, 200],
    [1, 1],
    [9.9, 5],
    [4.9, 2],
    [0.11, 0.1],
    [1000, 1000],
  ])('niceStep(%f) === %f', (input, want) => {
    expect(niceStep(input)).toBeCloseTo(want, 12);
  });

  it('is magnitude-symmetric and safe at zero', () => {
    expect(niceStep(-370)).toBe(niceStep(370));
    expect(niceStep(0)).toBe(0);
    expect(niceStep(NaN)).toBe(0);
  });

  it('derives a section line ten cells wide', () => {
    const { cell, section } = chooseGridSteps(100);
    expect(section).toBeCloseTo(cell * 10, 9);
  });

  it('never returns a zero cell, even for a degenerate model', () => {
    expect(chooseGridSteps(0).cell).toBeGreaterThan(0);
  });
});

describe('groundY', () => {
  it('sits just below the floor so a flat base does not z-fight', () => {
    const y = groundY(0, 10);
    expect(y).toBeLessThan(0);
    expect(Math.abs(y)).toBeLessThan(0.1); // imperceptible relative to a radius of 10
  });

  it('is finite for a zero-radius model', () => {
    expect(Number.isFinite(groundY(0, 0))).toBe(true);
  });
});

/* ------------------------------------------------------------ over a graph */

function meshAt(position: Vec3, size = 1): Mesh {
  const half = size / 2;
  const g = new BufferGeometry();
  // A minimal axis-aligned cube corner cloud is enough to define a box.
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-half, -half, -half, half, half, half]), 3),
  );
  const m = new Mesh(g, new MeshBasicMaterial());
  m.position.set(position[0], position[1], position[2]);
  return m;
}

describe('computeBounds', () => {
  it('measures a single mesh in world space', () => {
    const root = new Group();
    root.add(meshAt([0, 0, 0], 2));
    const b = computeBounds(root);
    expect(b.valid).toBe(true);
    expect(b.min).toEqual([-1, -1, -1]);
    expect(b.max).toEqual([1, 1, 1]);
    expect(b.size).toEqual([2, 2, 2]);
    expect(b.center).toEqual([0, 0, 0]);
  });

  it('includes a parent transform', () => {
    const root = new Group();
    root.position.set(100, 0, 0);
    root.add(meshAt([0, 0, 0], 2));
    const b = computeBounds(root);
    expect(b.center[0]).toBeCloseTo(100, 9);
  });

  it('respects a scaled and rotated ancestor', () => {
    const root = new Group();
    root.scale.setScalar(3);
    root.rotation.x = -Math.PI / 2;
    root.add(meshAt([0, 0, 0], 2));
    const b = computeBounds(root);
    expect(b.size[0]).toBeCloseTo(6, 6);
    expect(b.sphere.radius).toBeGreaterThan(0);
  });

  it('unions several meshes', () => {
    const root = new Group();
    root.add(meshAt([-10, 0, 0]), meshAt([10, 0, 0]));
    const b = computeBounds(root);
    expect(b.min[0]).toBeCloseTo(-10.5, 9);
    expect(b.max[0]).toBeCloseTo(10.5, 9);
  });

  // The reason for unioning per-mesh spheres instead of taking the box diagonal.
  it('gives a sphere tighter than the box diagonal for a round model', () => {
    const root = new Group();
    root.add(new Mesh(new SphereGeometry(50, 32, 16), new MeshBasicMaterial()));
    const b = computeBounds(root);
    const diagonalRadius = sphereRadiusFromBox(b.min, b.max);
    expect(b.sphere.radius).toBeCloseTo(50, 0);
    // The box-diagonal sphere would be sqrt(3) too big — a 73% framing error.
    expect(diagonalRadius).toBeGreaterThan(b.sphere.radius * 1.5);
  });

  it('reports invalid rather than poisoning the camera with NaN', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, NaN, 1, 2]), 3));
    const root = new Group();
    root.add(new Mesh(g, new MeshBasicMaterial()));
    const b = computeBounds(root);
    expect(b.valid).toBe(false);
    expect(Number.isFinite(b.sphere.radius)).toBe(true);
  });

  it('reports invalid for a graph with no geometry', () => {
    expect(computeBounds(new Group()).valid).toBe(false);
  });
});
