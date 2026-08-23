import type { ViewId } from './lib/camera';

/**
 * The imperative handle CameraRig publishes so DOM controls outside the <Canvas> can drive
 * the camera. A ref rather than state: these are commands, and putting the controls
 * instance in state would re-render the tree every time it attached.
 */
export interface ViewApi {
  /** Snap to a standard view, framing the current model. */
  applyView(view: ViewId, animate?: boolean): void;
  /** Re-frame the model without changing the viewing direction. */
  fit(animate?: boolean): void;
}
