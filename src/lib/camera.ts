/**
 * Camera geometry: standard view directions, fit distance, and depth-range selection.
 *
 * Pure and three-free. The governing idea is that EVERY camera constant is a multiple of the
 * model's bounding-sphere radius — there are no absolute lengths anywhere. That is what lets
 * a 10 mm machined part and a 100 m site scan behave identically without ever rescaling the
 * model itself.
 */
import { normalize, add, scale, angleBetweenDeg, type Vec3 } from './vec3';

export type ViewId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

export const VIEW_IDS: readonly ViewId[] = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'];

const ISO = 1 / Math.sqrt(3);

/**
 * Direction from the orbit TARGET towards the CAMERA, unit length, in a Y-up world.
 *
 * There are no quaternions here and we never write `camera.up`. CameraControls converts a
 * position + target into spherical coordinates and calls `makeSafe()` (clamping the polar
 * angle to [1e-6, PI-1e-6]) before `lookAt`. Top and bottom therefore resolve to a screen-up
 * of -Z and +Z respectively — the CAD drawing-sheet convention — without ever entering the
 * degenerate pole. That is a property of camera-controls, not something we impose.
 */
export const VIEW_DIRECTIONS: Readonly<Record<ViewId, Vec3>> = Object.freeze({
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  iso: [ISO, ISO, ISO],
});

/** Fraction of extra room left around a fitted model. */
export const FIT_PADDING = 1.15;

/**
 * Distance at which a sphere of `radius` exactly fills the frame.
 *
 * Uses the TIGHTER of the vertical and horizontal fields of view, matching camera-controls'
 * own `fitToSphere` maths so that the Fit button and the view buttons agree exactly rather
 * than differing by a few percent.
 *
 * Reference value: distanceToFitSphere(1, 50, 1, 1) === 1 / sin(25 deg) ~= 2.3662.
 */
export function distanceToFitSphere(
  radius: number,
  fovYDeg: number,
  aspect: number,
  padding: number = FIT_PADDING,
): number {
  const vFov = (fovYDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const fov = aspect > 1 ? vFov : hFov;
  return (Math.max(radius, 0) * padding) / Math.sin(fov / 2);
}

export interface DepthRange {
  readonly near: number;
  readonly far: number;
}

/**
 * Near and far planes for the CURRENT orbit distance, not just the model size.
 *
 * Recomputing per camera move is what keeps depth precision good at every scale: dollied out,
 * far/near approaches 1 and the 24-bit depth buffer is used almost entirely on the model;
 * dollied in, `near` is floored at far/maxRatio so the ratio can never blow up. This is why
 * `logarithmicDepthBuffer` is not needed — it costs fragment throughput, disables early-Z on
 * some drivers, and breaks any material writing gl_FragDepth.
 */
export function nearFarForDistance(radius: number, distance: number, maxRatio = 1e4): DepthRange {
  const r = Math.max(radius, 1e-6);
  const d = Math.max(distance, r * 1e-3);
  const far = d + r * 4;
  const near = Math.max(d - r * 2, far / maxRatio, r * 1e-5);
  return { near, far };
}

export interface OrbitLimits {
  readonly minDistance: number;
  readonly maxDistance: number;
}

/** Dolly limits, again purely relative to the model. */
export function orbitLimits(radius: number): OrbitLimits {
  const r = Math.max(radius, 1e-6);
  return { minDistance: r * 1e-3, maxDistance: r * 1e3 };
}

/** Camera position for a standard view: the target, offset along the view direction. */
export function cameraPositionFor(view: ViewId, center: Vec3, distance: number): Vec3 {
  return add(center, scale(VIEW_DIRECTIONS[view], distance));
}

/**
 * Which standard view the camera is currently in, or null if it is off-axis.
 *
 * Drives `aria-pressed` on the view buttons, so it is a genuine "you are here" rather than a
 * record of the last button clicked.
 *
 * @param dirTargetToCamera does not need to be normalised.
 */
export function matchView(dirTargetToCamera: Vec3, toleranceDeg = 1): ViewId | null {
  const dir = normalize(dirTargetToCamera);
  if (dir[0] === 0 && dir[1] === 0 && dir[2] === 0) return null;
  let best: ViewId | null = null;
  let bestAngle = Infinity;
  for (const id of VIEW_IDS) {
    const angle = angleBetweenDeg(dir, VIEW_DIRECTIONS[id]);
    if (angle < bestAngle) {
      bestAngle = angle;
      best = id;
    }
  }
  return bestAngle <= toleranceDeg ? best : null;
}
