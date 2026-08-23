import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type CameraControlsImpl from 'camera-controls';
import { PerspectiveCamera, Sphere, Vector3 } from 'three';
import {
  FIT_PADDING,
  cameraPositionFor,
  distanceToFitSphere,
  matchView,
  nearFarForDistance,
  orbitLimits,
  type ViewId,
} from '../lib/camera';
import type { ModelBounds } from '../lib/bounds';
import type { ViewApi } from '../types';

interface Props {
  bounds: ModelBounds;
  apiRef: React.RefObject<ViewApi | null>;
  onActiveViewChange?: (view: ViewId | null) => void;
  reduceMotion?: boolean;
}

const scratchPosition = new Vector3();
const scratchTarget = new Vector3();

/** A radius that is never zero, so a single-point model cannot divide by it. */
const safeRadius = (bounds: ModelBounds) => Math.max(bounds.sphere.radius, 1e-6);

/**
 * Owns the camera: standard views, fitting, and the depth range.
 *
 * CameraControls rather than OrbitControls, for one decisive reason beyond the smooth
 * transitions: it resolves the top and bottom views internally by clamping the polar angle
 * before lookAt, so we never write camera.up. With OrbitControls a true top view means
 * mutating the up vector, which changes the orbit axis under the user's hands.
 */
export function CameraRig({ bounds, apiRef, onActiveViewChange, reduceMotion = false }: Props) {
  const controlsRef = useRef<CameraControlsImpl | null>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useThree((s) => s.clock);
  const lastView = useRef<ViewId | null>(null);

  const center = bounds.sphere.center;

  /**
   * A PRECOMPUTED sphere, never the Object3D overload. camera-controls' own
   * createBoundingSphere clones every geometry and walks every vertex, so passing an object
   * would copy the whole model and run millions of distance checks on the main thread on
   * each press of Fit.
   */
  const fitSphere = useMemo(
    () =>
      new Sphere(new Vector3(center[0], center[1], center[2]), safeRadius(bounds) * FIT_PADDING),
    [bounds, center],
  );

  const fitDistance = useCallback(() => {
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
    const aspect = size.height > 0 ? size.width / size.height : 1;
    return distanceToFitSphere(safeRadius(bounds), fov, aspect);
  }, [camera, size.width, size.height, bounds]);

  /**
   * Throw away time accumulated while the render loop was idle.
   *
   * With frameloop="demand" the clock keeps running between frames, so the first frame after
   * a pause hands useFrame a delta of however long the viewer sat still. camera-controls
   * damps on that delta, and smoothDamp with a multi-second step lands on the target in one
   * go — turning every transition that follows an idle period into a jump cut. Measured: a
   * move that takes 399 ms when the loop is warm collapsed to 53 ms after 1.8 s idle.
   *
   * Consuming the stale delta here means the tween's first frame gets a normal ~16 ms step.
   */
  const resetFrameClock = useCallback(() => {
    clock.getDelta();
  }, [clock]);

  const applyView = useCallback(
    (view: ViewId, animate = !reduceMotion) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const [x, y, z] = cameraPositionFor(view, center, fitDistance());
      if (animate) resetFrameClock();
      void controls.setLookAt(x, y, z, center[0], center[1], center[2], animate);
      // AFTER setLookAt, never before: setLookAt writes _sphericalEnd without normalising,
      // so a user who has orbited several turns would otherwise watch the camera unwind all
      // of them on the way to the view.
      controls.normalizeRotations();
      invalidate();
    },
    [center, fitDistance, invalidate, reduceMotion, resetFrameClock],
  );

  const fit = useCallback(
    (animate = !reduceMotion) => {
      if (animate) resetFrameClock();
      void controlsRef.current?.fitToSphere(fitSphere, animate);
      invalidate();
    },
    [fitSphere, invalidate, reduceMotion, resetFrameClock],
  );

  const fitSphereAt = useCallback(
    (center: readonly [number, number, number], radius: number, animate = !reduceMotion) => {
      const controls = controlsRef.current;
      if (!controls) return;
      if (animate) resetFrameClock();
      const target = new Sphere(
        new Vector3(center[0], center[1], center[2]),
        Math.max(radius, 1e-6),
      );
      void controls.fitToSphere(target, animate);
      invalidate();
    },
    [invalidate, reduceMotion, resetFrameClock],
  );

  // Publish the imperative handle for the DOM toolbar outside the Canvas.
  useEffect(() => {
    apiRef.current = { applyView, fit, fitSphere: fitSphereAt };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, applyView, fit, fitSphereAt]);

  // Frame each new model, and keep the dolly limits proportional to it.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !bounds.valid) return;
    const { minDistance, maxDistance } = orbitLimits(safeRadius(bounds));
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;
    applyView('iso', false);
    // Deliberately keyed on the model alone. applyView is excluded because it changes with
    // the viewport size, and including it would re-frame the model on every window resize,
    // throwing away wherever the user had orbited to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.smoothTime = reduceMotion ? 0 : 0.12;
    controls.draggingSmoothTime = reduceMotion ? 0 : 0.06;
  }, [reduceMotion]);

  /**
   * Recompute the depth range from the CURRENT orbit distance, not just the model size.
   * Dollied out the near/far ratio approaches 1, so the depth buffer is spent almost
   * entirely on the model; dollied in, near is floored so the ratio cannot blow up. This is
   * why logarithmicDepthBuffer is unnecessary.
   */
  const handleUpdate = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    // `false` is load-bearing: getPosition/getTarget default receiveEndValue to TRUE and
    // return the DESTINATION of an in-flight transition, not where the camera actually is.
    // Reading the default would compute the depth range for a place the camera has not
    // reached — clipping the model for the whole flight — and would light up the view
    // button's aria-pressed the instant a move started rather than when it arrived.
    controls.getPosition(scratchPosition, false);
    controls.getTarget(scratchTarget, false);
    const distance = scratchPosition.distanceTo(scratchTarget);
    const { near, far } = nearFarForDistance(safeRadius(bounds), distance);

    // Only write when it actually moved, to avoid pointless projection-matrix rebuilds.
    if (Math.abs(camera.near - near) > near * 1e-3 || Math.abs(camera.far - far) > far * 1e-3) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }

    if (onActiveViewChange) {
      const view = matchView([
        scratchPosition.x - scratchTarget.x,
        scratchPosition.y - scratchTarget.y,
        scratchPosition.z - scratchTarget.z,
      ]);
      // Guarded so a continuous orbit produces at most a couple of renders, not one a frame.
      if (view !== lastView.current) {
        lastView.current = view;
        onActiveViewChange(view);
      }
    }
  }, [bounds, camera, onActiveViewChange]);

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      dollyToCursor
      infinityDolly={false}
      onUpdate={handleUpdate}
    />
  );
}
