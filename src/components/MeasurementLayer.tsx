import { useMemo, useRef } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, Vector3, type Group, type Mesh } from 'three';
import { measurementLength, measurementMidpoint, type Measurement, type MeasurePoint } from '../lib/measure';
import { formatLength, type UnitChoice, type UnitSystem } from '../lib/units';
import type { Vec3 } from '../lib/vec3';

interface Props {
  items: readonly Measurement[];
  draftPoint: MeasurePoint | null;
  /** A ref, not a value: the hover point changes at pointer rate and must not re-render. */
  hoverRef: React.RefObject<MeasurePoint | null>;
  measuring: boolean;
  selectedId: number | null;
  metersPerUnit: number | null;
  unit: UnitChoice;
  system: UnitSystem;
  onSelect(id: number): void;
}

/** A marker sized in pixels rather than world units, so 1 mm and 100 m parts look the same. */
const MARKER_PX = 7;
const scratch = new Vector3();

function markerScale(world: Vec3, camera: { position: Vector3 }, viewportHeight: number, fovDeg: number): number {
  const distance = camera.position.distanceTo(scratch.set(world[0], world[1], world[2])) || 1;
  const worldPerPixel = (2 * Math.tan(((fovDeg || 45) * Math.PI) / 360) * distance) / Math.max(viewportHeight, 1);
  return worldPerPixel * MARKER_PX;
}

/**
 * The in-scene half of the ruler.
 *
 * Every element is deliberately depth-independent — `depthTest: false`, drawn last. That is
 * not a workaround: CAD dimension annotations behave this way everywhere, a measurement
 * whose far endpoint sits inside the part is still one you need to read, and it sidesteps
 * z-fighting between a marker and the surface it rests on.
 *
 * The draft marker and line are mutated through refs inside a single useFrame rather than
 * re-rendered, so moving the pointer costs zero React renders. React only commits when a
 * measurement is created, deleted, cleared or selected.
 */
export function MeasurementLayer({
  items, draftPoint, hoverRef, measuring, selectedId, metersPerUnit, unit, system, onSelect,
}: Props) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const fov = (camera as { fov?: number }).fov ?? 45;

  const ghostMarker = useRef<Mesh>(null);
  const ghostLine = useRef<Group>(null);
  const committedMarkers = useRef<Map<string, Mesh>>(new Map());

  // A 2-point geometry mutated in place. drei's <Line> rebuilds its geometry in a useMemo
  // keyed on `points`, so it must never be re-rendered per frame.
  const draftGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);

  useFrame(() => {
    // Keep every marker a constant pixel size, and follow the hover point, without a render.
    for (const [key, mesh] of committedMarkers.current) {
      if (!mesh) continue;
      const p: Vec3 = [mesh.position.x, mesh.position.y, mesh.position.z];
      const s = markerScale(p, camera, size.height, fov);
      mesh.scale.setScalar(s);
      void key;
    }

    const live = measuring ? hoverRef.current : null;
    const marker = ghostMarker.current;
    if (marker) {
      marker.visible = live !== null;
      if (live) {
        marker.position.set(live.p[0], live.p[1], live.p[2]);
        marker.scale.setScalar(markerScale(live.p, camera, size.height, fov));
      }
    }

    const line = ghostLine.current;
    if (line) {
      const show = draftPoint !== null && live !== null;
      line.visible = show;
      if (show && draftPoint && live) {
        const attr = draftGeometry.getAttribute('position');
        attr.setXYZ(0, draftPoint.p[0], draftPoint.p[1], draftPoint.p[2]);
        attr.setXYZ(1, live.p[0], live.p[1], live.p[2]);
        attr.needsUpdate = true;
        draftGeometry.computeBoundingSphere();
      }
    }
  });

  return (
    <group renderOrder={10}>
      {items.map((m) => {
        const label = formatLength(measurementLength(m), metersPerUnit, unit, system).text;
        const mid = measurementMidpoint(m);
        const selected = m.id === selectedId;
        const colour = selected ? '#43c98a' : '#5b8cff';
        return (
          <group key={m.id}>
            <Line
              points={[[...m.a.p], [...m.b.p]] as [number, number, number][]}
              color={colour}
              lineWidth={selected ? 3 : 2}
              depthTest={false}
              renderOrder={10}
            />
            {[m.a, m.b].map((end, i) => (
              <mesh
                key={i}
                ref={(node) => {
                  if (node) committedMarkers.current.set(`${m.id}:${i}`, node);
                  else committedMarkers.current.delete(`${m.id}:${i}`);
                }}
                position={[...end.p] as [number, number, number]}
                renderOrder={11}
              >
                <sphereGeometry args={[1, 16, 12]} />
                <meshBasicMaterial color={colour} depthTest={false} toneMapped={false} />
              </mesh>
            ))}
            <Html center position={[...mid] as [number, number, number]} zIndexRange={[8, 0]}>
              <button
                type="button"
                className={`measure-label${selected ? ' selected' : ''}`}
                data-measure-label={m.id}
                onClick={() => onSelect(m.id)}
              >
                {label}
              </button>
            </Html>
          </group>
        );
      })}

      {/* Draft: a dashed line to the live cursor, and a marker on the committed first point. */}
      {draftPoint && (
        <mesh position={[...draftPoint.p] as [number, number, number]} renderOrder={11}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial color="#f0b34a" depthTest={false} toneMapped={false} />
        </mesh>
      )}
      <group ref={ghostLine} visible={false}>
        <lineSegments geometry={draftGeometry} renderOrder={10}>
          <lineDashedMaterial color="#9aa1ad" dashSize={0.4} gapSize={0.2} depthTest={false} />
        </lineSegments>
      </group>
      <mesh ref={ghostMarker} visible={false} renderOrder={11}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshBasicMaterial color="#f0b34a" depthTest={false} toneMapped={false} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}
