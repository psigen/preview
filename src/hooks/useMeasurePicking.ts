import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Raycaster, Vector2, Vector3, type Intersection, type Mesh, type Object3D } from 'three';
import { chooseSnap, type MeasurePoint, type Project, type SnapMode } from '../lib/measure';
import { LIMITS } from '../lib/limits';
import type { Vec3 } from '../lib/vec3';

interface Options {
  root: Object3D | null;
  enabled: boolean;
  snap: SnapMode;
  onPick(point: MeasurePoint): void;
  /** Called on every hover evaluation, including with null when nothing is under the cursor. */
  onHover(point: MeasurePoint | null): void;
}

const raycaster = new Raycaster();
const pointerNdc = new Vector2();
const scratch = new Vector3();

const toTuple = (v: Vector3): Vec3 => [v.x, v.y, v.z];

/**
 * Surface picking with a manual raycaster.
 *
 * Deliberately NOT R3F's event system. Objects enter its interaction list simply by having
 * any handler at all, so an onClick on the model would cost a full raycast on every
 * pointermove whether or not hover was wanted. Owning the raycaster means users who never
 * measure pay nothing, and while measuring we throttle to exactly one ray per rendered
 * frame.
 *
 * Pointer discipline follows videoclip's CropOverlay: capture the pointer, apply a
 * click-versus-drag threshold, and treat pointercancel as an abandonment. Without the
 * threshold an orbit drag drops a stray measurement point every time.
 */
export function useMeasurePicking({ root, enabled, snap, onPick, onHover }: Options): void {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  const params = useRef({ root, enabled, snap, onPick, onHover, camera, size, invalidate });
  useEffect(() => {
    params.current = { root, enabled, snap, onPick, onHover, camera, size, invalidate };
  });

  useEffect(() => {
    const element = gl.domElement;
    const down = { x: 0, y: 0, id: -1, active: false };

    const evaluate = (clientX: number, clientY: number): MeasurePoint | null => {
      const p = params.current;
      if (!p.root) return null;
      const rect = element.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      pointerNdc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointerNdc, p.camera);
      // A three-mesh-bvh flag: stop at the first hit instead of sorting every one.
      (raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
      // Points need a world-space threshold, scaled so it stays a constant screen size.
      raycaster.params.Points.threshold = pointThreshold(p.camera, p.root, rect.height);

      const hits: Intersection[] = raycaster.intersectObject(p.root, true);
      const hit = hits[0];
      if (!hit) return null;

      const project: Project = (world) => {
        scratch.set(world[0], world[1], world[2]).project(p.camera);
        return [((scratch.x + 1) / 2) * rect.width, ((-scratch.y + 1) / 2) * rect.height];
      };

      const hitPoint = toTuple(hit.point);
      const normal = hit.normal ? toTuple(hit.normal.clone().normalize()) : null;

      const triangle = triangleOf(hit);
      if (!triangle) return { p: hitPoint, n: normal, snap: 'surface' };
      return chooseSnap(hitPoint, triangle, project, LIMITS.snapPx, p.snap, normal);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!params.current.enabled || event.button !== 0) return;
      down.x = event.clientX;
      down.y = event.clientY;
      down.id = event.pointerId;
      down.active = true;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* the pointer may already be gone; not fatal */
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!params.current.enabled) return;
      params.current.onHover(evaluate(event.clientX, event.clientY));
      params.current.invalidate();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!down.active || event.pointerId !== down.id) return;
      down.active = false;
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      if (!params.current.enabled) return;
      // Anything beyond the threshold was an orbit, not a click.
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > LIMITS.dragPx) return;
      const point = evaluate(event.clientX, event.clientY);
      if (point) params.current.onPick(point);
    };

    const onPointerCancel = () => {
      // An interrupted gesture is an abandonment, never a click.
      down.active = false;
    };

    const onPointerLeave = () => {
      if (params.current.enabled) {
        params.current.onHover(null);
        params.current.invalidate();
      }
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerCancel);
    element.addEventListener('lostpointercapture', onPointerCancel);
    element.addEventListener('pointerleave', onPointerLeave);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
      element.removeEventListener('lostpointercapture', onPointerCancel);
      element.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [gl]);
}

/** The three world-space corners of the hit triangle, when there is one. */
function triangleOf(hit: Intersection): [Vec3, Vec3, Vec3] | null {
  const face = hit.face;
  const mesh = hit.object as Mesh;
  const position = mesh.geometry?.attributes?.position;
  if (!face || !position) return null;

  const corner = (index: number): Vec3 => {
    scratch.fromBufferAttribute(position as never, index);
    // MUST go through matrixWorld: reading the raw attribute would return file-space
    // coordinates, which are wrong for any scaled or rotated model — and USD scales its root.
    mesh.localToWorld(scratch);
    return [scratch.x, scratch.y, scratch.z];
  };
  return [corner(face.a), corner(face.b), corner(face.c)];
}

/**
 * Points have no area, so raycasting them uses a world-space radius. Scaling it by the
 * current view distance keeps that radius a roughly constant number of pixels.
 */
function pointThreshold(
  camera: { position: Vector3 },
  root: Object3D,
  viewportHeight: number,
): number {
  root.getWorldPosition(scratch);
  const distance = camera.position.distanceTo(scratch) || 1;
  return (distance * LIMITS.snapPx) / Math.max(viewportHeight, 1);
}
