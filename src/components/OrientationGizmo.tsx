import { GizmoHelper, GizmoViewport } from '@react-three/drei';

/**
 * A read-only orientation indicator.
 *
 * `disabled` is deliberate. drei 10.7's clickable gizmo is broken for any model not centred
 * on the world origin — which is normal in CAD, where parts carry absolute coordinates.
 * Its tweenCamera measures the orbit radius against an unassigned module-scope vector that
 * is always the origin, rather than the focus point it computes two lines earlier, and it
 * moves the camera with setPosition alone and no setTarget, desyncing CameraControls.
 *
 * With `disabled` the pointer handlers are undefined and that code is unreachable, leaving
 * the half that works: GizmoHelper syncing the cube's orientation to the camera each frame.
 * All view changes go through the toolbar and the keyboard instead.
 */
export function OrientationGizmo() {
  return (
    <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
      <GizmoViewport disabled axisColors={['#e06c75', '#98c379', '#5b8cff']} labelColor="#e7e9ee" />
    </GizmoHelper>
  );
}
