import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DirectionalLight, Vector3 } from 'three';
import { useRoomEnvironment } from '../hooks/useRoomEnvironment';

const right = new Vector3();
const up = new Vector3();
const forward = new Vector3();

interface Props {
  /** Orbit target, so the key light aims at what the user is looking at. */
  target: readonly [number, number, number];
}

/**
 * Procedural image-based lighting, plus one key light that tracks the camera.
 *
 * RoomEnvironment alone is a soft box: correct exposure everywhere, but poor curvature cues
 * on the matte grey a raw STL gets. A single directional light over the camera's left
 * shoulder restores the shading gradient that makes a form readable.
 *
 * There is no ambientLight — the IBL is the ambient — and no shadows, which would need a
 * receiver plane plus shadow-camera and bias values re-derived per model from the bounding
 * sphere.
 *
 * Tracking happens in useFrame rather than in CameraRig's onUpdate so the two concerns stay
 * separate. Under frameloop="demand" a frame only runs when something invalidated, which
 * includes every camera move, so this costs a few vector operations exactly when needed.
 */
export function SceneEnvironment({ target }: Props) {
  useRoomEnvironment();
  const lightRef = useRef<DirectionalLight>(null);

  useFrame(({ camera }) => {
    const light = lightRef.current;
    if (!light) return;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    forward.set(target[0], target[1], target[2]).sub(camera.position);
    const distance = forward.length() || 1;

    light.position
      .copy(camera.position)
      .addScaledVector(up, distance * 0.5)
      .addScaledVector(right, distance * -0.4);
    light.target.position.set(target[0], target[1], target[2]);
    light.target.updateMatrixWorld();
  });

  // light.target is not added to the scene: it is not rendered, and we refresh its world
  // matrix by hand above, which is all three reads when computing the light direction.
  return <directionalLight ref={lightRef} intensity={0.55} />;
}
