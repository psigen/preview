/**
 * Minimal tuple vector maths, shared by the camera, bounds and measurement modules.
 *
 * Tuples rather than THREE.Vector3 so that every consumer stays testable in plain Node with
 * no three import, and so values are structurally comparable in assertions.
 */
export type Vec3 = readonly [number, number, number];

const ZERO: Vec3 = [0, 0, 0];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const midpoint = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len === 0 ? ZERO : [a[0] / len, a[1] / len, a[2] / len];
}

export function isFiniteVec(a: Vec3): boolean {
  return Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);
}

/** Angle between two vectors in degrees. Returns NaN if either is zero-length. */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la === 0 || lb === 0) return NaN;
  // Clamp guards against a dot product drifting outside [-1, 1] through rounding.
  const cos = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}
