import { useCallback, useEffect, useRef } from 'react';
import type { Object3D } from 'three';
import { useMeasurePicking } from '../hooks/useMeasurePicking';
import { useMeshBvh, type BvhStatus } from '../hooks/useMeshBvh';
import type { MeasureAction, MeasurePoint, MeasureState } from '../lib/measure';
import { MeasurementLayer } from './MeasurementLayer';
import type { UnitChoice, UnitSystem } from '../lib/units';

interface Props {
  root: Object3D | null;
  state: MeasureState;
  dispatch(action: MeasureAction): void;
  metersPerUnit: number | null;
  unit: UnitChoice;
  system: UnitSystem;
  onBvhStatus?(status: BvhStatus): void;
}

/**
 * Lives inside the Canvas and owns everything measurement-related that needs the renderer.
 *
 * The live hover point is held in a REF, never in state. It changes at pointer rate, and the
 * only thing that needs it is a marker position updated in useFrame — so putting it in state
 * would re-render the whole scene graph a hundred times a second to move one sphere.
 */
export function MeasureController({
  root,
  state,
  dispatch,
  metersPerUnit,
  unit,
  system,
  onBvhStatus,
}: Props) {
  const hoverRef = useRef<MeasurePoint | null>(null);
  const measuring = state.mode === 'point-to-point';

  // Built only once the tool is actually opened.
  const bvh = useMeshBvh(root, measuring);
  useEffect(() => {
    onBvhStatus?.(bvh);
  }, [bvh, onBvhStatus]);

  const onHover = useCallback((point: MeasurePoint | null) => {
    hoverRef.current = point;
  }, []);

  const onPick = useCallback(
    (point: MeasurePoint) => dispatch({ type: 'pick', point }),
    [dispatch],
  );

  useMeasurePicking({ root, enabled: measuring, snap: state.snap, onPick, onHover });

  return (
    <MeasurementLayer
      items={state.items}
      draftPoint={state.draft.phase === 'first' ? state.draft.a : null}
      hoverRef={hoverRef}
      measuring={measuring}
      selectedId={state.selectedId}
      metersPerUnit={metersPerUnit}
      unit={unit}
      system={system}
      onSelect={(id) => dispatch({ type: 'select', id })}
    />
  );
}
