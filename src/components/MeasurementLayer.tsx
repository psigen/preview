import { useCallback, useMemo, useRef } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, type Group, type Mesh } from 'three';
import { worldPerPixel } from '../lib/camera';
import {
  measurementLength,
  measurementMidpoint,
  type Measurement,
  type MeasurePoint,
} from '../lib/measure';
import { formatLength, type UnitChoice, type UnitSystem } from '../lib/units';

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

/** Marker radius in screen pixels. Never a world-space length — see `worldPerPixel`. */
const MARKER_PX = 7;

/** Adds a mesh to the per-frame rescaling set and removes it on unmount. */
type Register = (node: Mesh | null) => () => void;

/**
 * A sphere held at a constant pixel radius by the layer's single `useFrame`.
 *
 * Registration happens here rather than at each call site, so it cannot be forgotten: this
 * is the only way the layer creates a marker, and every marker it creates is screen-sized.
 * The draft marker used to be a bare `<mesh>` with a radius of one *world* unit, which made
 * it swallow a millimetre-scale part and vanish on a large one.
 */
function Marker({
  colour,
  register,
  position,
  opacity,
  meshRef,
  visible,
}: {
  colour: string;
  register: Register;
  position?: [number, number, number];
  opacity?: number;
  meshRef?: React.RefObject<Mesh | null>;
  /** Initial value only — `useFrame` owns visibility for the ghost from the next frame on. */
  visible?: boolean;
}) {
  const attach = useCallback(
    (node: Mesh | null) => {
      if (meshRef) meshRef.current = node;
      const unregister = register(node);
      return () => {
        unregister();
        if (meshRef) meshRef.current = null;
      };
    },
    [register, meshRef],
  );

  return (
    <mesh ref={attach} position={position} visible={visible} renderOrder={11}>
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial
        color={colour}
        depthTest={false}
        toneMapped={false}
        transparent={opacity !== undefined}
        opacity={opacity ?? 1}
      />
    </mesh>
  );
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
  items,
  draftPoint,
  hoverRef,
  measuring,
  selectedId,
  metersPerUnit,
  unit,
  system,
  onSelect,
}: Props) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const fov = (camera as { fov?: number }).fov ?? 45;

  const ghostMarker = useRef<Mesh>(null);
  const ghostLine = useRef<Group>(null);
  const markers = useRef<Set<Mesh>>(new Set());

  const register = useCallback<Register>((node) => {
    if (node) markers.current.add(node);
    return () => {
      if (node) markers.current.delete(node);
    };
  }, []);

  // A 2-point geometry mutated in place. drei's <Line> rebuilds its geometry in a useMemo
  // keyed on `points`, so it must never be re-rendered per frame.
  const draftGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);

  useFrame(() => {
    // The ghost follows the pointer. Position first, so the rescale below sees where it
    // actually is this frame rather than where it was last frame.
    const live = measuring ? hoverRef.current : null;
    const ghost = ghostMarker.current;
    if (ghost) {
      ghost.visible = live !== null;
      if (live) ghost.position.set(live.p[0], live.p[1], live.p[2]);
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

    // One place scales every marker — committed, draft and ghost alike. `mesh.position` is
    // this group's local space, and the group carries no transform, so it is world space.
    for (const mesh of markers.current) {
      if (!mesh.visible) continue;
      const distance = camera.position.distanceTo(mesh.position) || 1;
      mesh.scale.setScalar(worldPerPixel(distance, size.height, fov) * MARKER_PX);
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
              <Marker
                key={i}
                colour={colour}
                register={register}
                position={[...end.p] as [number, number, number]}
              />
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
        <Marker
          colour="#f0b34a"
          register={register}
          position={[...draftPoint.p] as [number, number, number]}
        />
      )}
      <group ref={ghostLine} visible={false}>
        <lineSegments geometry={draftGeometry} renderOrder={10}>
          <lineDashedMaterial color="#9aa1ad" dashSize={0.4} gapSize={0.2} depthTest={false} />
        </lineSegments>
      </group>
      <Marker
        colour="#f0b34a"
        register={register}
        opacity={0.8}
        meshRef={ghostMarker}
        visible={false}
      />
    </group>
  );
}
