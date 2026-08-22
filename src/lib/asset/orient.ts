/**
 * Up-axis normalisation.
 *
 * Invariant: `LoadedModel.object` is ALWAYS Y-up. A rotation is an isometry, so baking one
 * cannot change a measured distance — which is the whole justification for normalising the
 * data rather than teaching drei's Grid, the gizmo and every view button about up-axis.
 * Exactly one place can then be wrong.
 *
 * Plugins never apply the rotation themselves. They declare `sourceUpAxis` and `orientation`
 * and the finaliser acts once, so a loader that already rotated (three's USDLoader does, for
 * a Z-up stage) is not rotated twice.
 */
import { Group, Matrix4, Object3D } from 'three';
import type { Orientation, UpAxis } from './types';

/** Rotating -90 degrees about X maps a Z-up frame onto a Y-up one: (x,y,z) -> (x, z, -y). */
export const Z_UP_TO_Y_UP_X_ROTATION = -Math.PI / 2;

/** The X rotation the wrapper needs, in radians. Zero unless the source is Z-up and unrotated. */
export function upAxisRotationX(orientation: Orientation, sourceUpAxis: UpAxis): number {
  return orientation === 'file' && sourceUpAxis === 'Z' ? Z_UP_TO_Y_UP_X_ROTATION : 0;
}

/**
 * Wrap a plugin's root in a Y-up container.
 *
 * The wrapper ALWAYS exists, even when no rotation is needed, because it gives the app an
 * Object3D it can transform freely without ever clobbering a unit scale a loader baked into
 * its own root.
 */
export function wrapForUpAxis(
  root: Object3D,
  orientation: Orientation,
  sourceUpAxis: UpAxis,
  name = 'model',
): Group {
  const wrapper = new Group();
  wrapper.name = name;
  wrapper.rotation.x = upAxisRotationX(orientation, sourceUpAxis);
  wrapper.add(root);
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

/**
 * The transform taking file-space coordinates to world space: world = worldFromFile * file.
 *
 * Recovered uniformly from the plugin root's world matrix rather than reconstructed, so it
 * automatically includes both our wrapper rotation and anything the loader baked in. Invert
 * it to show a picked point back in the file's own coordinates.
 */
export function worldFromFile(pluginRoot: Object3D): Matrix4 {
  pluginRoot.updateMatrixWorld(true);
  return pluginRoot.matrixWorld.clone();
}
