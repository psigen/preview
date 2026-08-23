import { describe, expect, it } from 'vitest';
import {
  add,
  angleBetweenDeg,
  distance,
  dot,
  isFiniteVec,
  length,
  midpoint,
  normalize,
  scale,
  sub,
  type Vec3,
} from './vec3';

describe('vec3', () => {
  const a: Vec3 = [1, 2, 3];
  const b: Vec3 = [4, 5, 6];

  it('does the obvious arithmetic', () => {
    expect(add(a, b)).toEqual([5, 7, 9]);
    expect(sub(b, a)).toEqual([3, 3, 3]);
    expect(scale(a, 2)).toEqual([2, 4, 6]);
    expect(dot(a, b)).toBe(32);
    expect(midpoint(a, b)).toEqual([2.5, 3.5, 4.5]);
  });

  it('measures length and distance', () => {
    expect(length([3, 4, 0])).toBe(5);
    expect(distance([1, 0, 0], [1, 3, 4])).toBe(5);
  });

  it('normalises to unit length', () => {
    const n = normalize([0, 0, -7]);
    expect(n).toEqual([0, 0, -1]);
    expect(length(normalize(a))).toBeCloseTo(1, 15);
  });

  it('returns zero rather than NaN when normalising a zero vector', () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('reports finiteness', () => {
    expect(isFiniteVec([1, 2, 3])).toBe(true);
    expect(isFiniteVec([1, NaN, 3])).toBe(false);
    expect(isFiniteVec([1, Infinity, 3])).toBe(false);
  });

  describe('angleBetweenDeg', () => {
    it('measures the obvious angles', () => {
      expect(angleBetweenDeg([1, 0, 0], [1, 0, 0])).toBeCloseTo(0, 9);
      expect(angleBetweenDeg([1, 0, 0], [0, 1, 0])).toBeCloseTo(90, 9);
      expect(angleBetweenDeg([1, 0, 0], [-1, 0, 0])).toBeCloseTo(180, 9);
    });

    it('ignores magnitude', () => {
      expect(angleBetweenDeg([5, 0, 0], [0, 0.001, 0])).toBeCloseTo(90, 9);
    });

    // Without clamping, a dot product of 1.0000000000000002 makes Math.acos return NaN.
    it('clamps the cosine so identical vectors never yield NaN', () => {
      const v: Vec3 = [0.5773502691896258, 0.5773502691896258, 0.5773502691896258];
      expect(angleBetweenDeg(v, v)).toBeCloseTo(0, 9);
      expect(Number.isNaN(angleBetweenDeg(v, v))).toBe(false);
    });

    it('is NaN for a zero-length input, rather than silently zero', () => {
      expect(angleBetweenDeg([0, 0, 0], [1, 0, 0])).toBeNaN();
    });
  });
});
