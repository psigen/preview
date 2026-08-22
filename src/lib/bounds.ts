/**
 * Bounding geometry for a loaded model, and the grid sizing derived from it.
 *
 * Two things here are deliberate:
 *
 * 1. The sphere is a UNION OF PER-MESH SPHERES, not the box diagonal. A box-diagonal sphere
 *    is up to sqrt(3) too large — a sphere inside a 100^3 box gets r = 86.6 instead of 50, so
 *    Fit puts the camera 73% too far out and the model looks small. Unioning each mesh's own
 *    cached boundingSphere is still O(#meshes) and is tight for exactly the round parts where
 *    the box is loose.
 *
 * 2. Everything is O(#meshes), never O(#vertices). three caches geometry.boundingBox and
 *    .boundingSphere after the first computation, so we never walk vertices and never call
 *    Box3.setFromObject(root, true).
 */
import { Box3, Object3D, Sphere, Vector3 } from 'three';
import { add, length, scale, sub, type Vec3 } from './vec3';

export interface BoundingSphere {
  readonly center: Vec3;
  readonly radius: number;
}

export interface ModelBounds {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly center: Vec3;
  readonly size: Vec3;
  readonly sphere: BoundingSphere;
  /**
   * False when the model has no geometry, or when its geometry contains NaN or Infinity.
   * A non-finite box poisons the camera maths and shows as a black screen with no
   * diagnostic, so callers must substitute a fallback rather than propagate it.
   */
  readonly valid: boolean;
}

/* ------------------------------------------------------- pure number maths */

export const boxSize = (min: Vec3, max: Vec3): Vec3 => sub(max, min);
export const boxCenter = (min: Vec3, max: Vec3): Vec3 => scale(add(min, max), 0.5);

/** Radius of the sphere circumscribing a box — half its diagonal. */
export const sphereRadiusFromBox = (min: Vec3, max: Vec3): number => length(boxSize(min, max)) / 2;

export function isFiniteBox(min: Vec3, max: Vec3): boolean {
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(min[i]!) || !Number.isFinite(max[i]!)) return false;
    if (min[i]! > max[i]!) return false;
  }
  return true;
}

/** Smallest sphere containing both inputs. */
export function mergeSpheres(a: BoundingSphere, b: BoundingSphere): BoundingSphere {
  const between = sub(b.center, a.center);
  const d = length(between);
  if (d + b.radius <= a.radius) return a;
  if (d + a.radius <= b.radius) return b;
  if (d === 0) return { center: a.center, radius: Math.max(a.radius, b.radius) };
  const radius = (a.radius + b.radius + d) / 2;
  const t = (radius - a.radius) / d;
  return { center: add(a.center, scale(between, t)), radius };
}

export function unionSphere(spheres: readonly BoundingSphere[]): BoundingSphere {
  if (spheres.length === 0) return { center: [0, 0, 0], radius: 0 };
  return spheres.reduce(mergeSpheres);
}

/** Snap a magnitude down to the nearest 1-2-5 step. niceStep(0.037) === 0.02. */
export function niceStep(x: number): number {
  const a = Math.abs(x);
  if (!Number.isFinite(a) || a === 0) return 0;
  const exponent = Math.floor(Math.log10(a));
  const decade = Math.pow(10, exponent);
  const mantissa = a / decade;
  const step = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
  return step * decade;
}

/** Grid cell and heavier section line, sized to the model. */
export function chooseGridSteps(extent: number): { cell: number; section: number } {
  const cell = niceStep(extent / 10) || 1;
  return { cell, section: cell * 10 };
}

/**
 * Where to plant the ground grid. The bbox floor, biased by a hair so a flat-bottomed part
 * resting on it does not z-fight along its whole base.
 */
export function groundY(minY: number, radius: number): number {
  return minY - Math.max(radius, 1e-6) * 1e-3;
}

/* --------------------------------------------------------- over a scene graph */

const EMPTY: ModelBounds = Object.freeze({
  min: [0, 0, 0] as Vec3,
  max: [0, 0, 0] as Vec3,
  center: [0, 0, 0] as Vec3,
  size: [0, 0, 0] as Vec3,
  sphere: { center: [0, 0, 0] as Vec3, radius: 0 },
  valid: false,
});

export function computeBounds(root: Object3D): ModelBounds {
  root.updateMatrixWorld(true);

  const box = new Box3();
  const spheres: BoundingSphere[] = [];
  const scratchSphere = new Sphere();
  const scratchBox = new Box3();
  const scratchVec = new Vector3();
  let any = false;

  root.traverse((o) => {
    const geometry = (o as { geometry?: import('three').BufferGeometry }).geometry;
    if (!geometry?.attributes?.position) return;

    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    if (!geometry.boundingBox || !geometry.boundingSphere) return;

    scratchBox.copy(geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (!Number.isFinite(scratchBox.min.x) || !Number.isFinite(scratchBox.max.x)) return;
    box.union(scratchBox);

    scratchSphere.copy(geometry.boundingSphere).applyMatrix4(o.matrixWorld);
    if (!Number.isFinite(scratchSphere.radius)) return;
    spheres.push({
      center: [scratchSphere.center.x, scratchSphere.center.y, scratchSphere.center.z],
      radius: scratchSphere.radius,
    });
    any = true;
  });

  if (!any || box.isEmpty()) return EMPTY;

  const min: Vec3 = [box.min.x, box.min.y, box.min.z];
  const max: Vec3 = [box.max.x, box.max.y, box.max.z];
  if (!isFiniteBox(min, max)) return EMPTY;

  box.getCenter(scratchVec);
  return {
    min,
    max,
    center: [scratchVec.x, scratchVec.y, scratchVec.z],
    size: boxSize(min, max),
    sphere: unionSphere(spheres),
    valid: true,
  };
}
