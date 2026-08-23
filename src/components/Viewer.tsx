import { Canvas } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import type { LoadedModel } from '../lib/asset/types';
import type { ModelBounds } from '../lib/bounds';
import type { ViewId } from '../lib/camera';
import type { ViewApi } from '../types';
import { CameraRig } from './CameraRig';
import { ModelRoot } from './ModelRoot';
import { OrientationGizmo } from './OrientationGizmo';
import { SceneEnvironment } from './SceneEnvironment';

interface Props {
  model: LoadedModel;
  bounds: ModelBounds;
  apiRef: React.RefObject<ViewApi | null>;
  onActiveViewChange?: (view: ViewId | null) => void;
  reduceMotion?: boolean;
}

export function Viewer({ model, bounds, apiRef, onActiveViewChange, reduceMotion }: Props) {
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
        // Khronos PBR Neutral rather than ACES, which desaturates and shifts hue — wrong
        // when the user's part is colour-coded.
        gl.toneMapping = NeutralToneMapping;
        gl.toneMappingExposure = 1;
        scene.background = null;
      }}
    >
      <SceneEnvironment target={bounds.sphere.center} />
      <ModelRoot key={model.id} model={model} />
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
