import { Canvas } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import { setDecoderRenderer } from '../lib/decoders/gltfDecoders';
import type { LoadedModel } from '../lib/asset/types';
import type { ModelBounds } from '../lib/bounds';
import type { ViewId } from '../lib/camera';
import type { ViewApi } from '../types';
import type { MeasureAction, MeasureState } from '../lib/measure';
import type { UnitChoice, UnitSystem } from '../lib/units';
import { CameraRig } from './CameraRig';
import { MeasureController } from './MeasureController';
import { ModelRoot } from './ModelRoot';
import { OrientationGizmo } from './OrientationGizmo';
import { SceneEnvironment } from './SceneEnvironment';

interface Props {
  model: LoadedModel;
  bounds: ModelBounds;
  apiRef: React.RefObject<ViewApi | null>;
  onActiveViewChange?: (view: ViewId | null) => void;
  reduceMotion?: boolean;
  measure: MeasureState;
  dispatchMeasure(action: MeasureAction): void;
  unit: UnitChoice;
  system: UnitSystem;
}

export function Viewer({
  model,
  bounds,
  apiRef,
  onActiveViewChange,
  reduceMotion,
  measure,
  dispatchMeasure,
  unit,
  system,
}: Props) {
  return (
    <Canvas
      className="viewer-canvas"
      // An idle viewer costs 0% GPU. CameraControls invalidates on its own events, so
      // orbiting renders normally; every imperative mutation elsewhere must call
      // invalidate() explicitly.
      frameloop="demand"
      dpr={[1, 2]}
      // No AdaptiveDpr or PerformanceMonitor: resolution popping mid-orbit reads as a
      // rendering bug in a tool meant for inspection.
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      }}
      // 45 rather than R3F's default 75: less perspective distortion, and closer to how CAD
      // viewers present a part. near/far are placeholders; CameraRig derives the real ones
      // from the model and the current orbit distance.
      camera={{ fov: 45, near: 0.1, far: 1000, position: [1, 1, 1] }}
      onCreated={({ gl, scene }) => {
        // KTX2 needs a live renderer to know which compressed texture formats the GPU
        // supports; without this, a .ktx2-textured glTF loads untextured with a warning.
        setDecoderRenderer(gl);
        // Khronos PBR Neutral rather than ACES, which desaturates and shifts hue — wrong
        // when the user's part is colour-coded.
        gl.toneMapping = NeutralToneMapping;
        gl.toneMappingExposure = 1;
        scene.background = null;
      }}
    >
      <SceneEnvironment target={bounds.sphere.center} />
      <ModelRoot key={model.id} model={model} />
      <MeasureController
        root={model.object}
        state={measure}
        dispatch={dispatchMeasure}
        metersPerUnit={model.units.known ? model.units.metersPerUnit : null}
        unit={unit}
        system={system}
      />
      <CameraRig
        bounds={bounds}
        apiRef={apiRef}
        onActiveViewChange={onActiveViewChange}
        reduceMotion={reduceMotion}
      />
      <OrientationGizmo />
    </Canvas>
  );
}
