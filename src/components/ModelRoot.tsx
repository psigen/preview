import type { LoadedModel } from '../lib/asset/types';

interface Props {
  model: LoadedModel;
}

/**
 * Mounts a loaded model's scene graph.
 *
 * `model.object` is the wrapper the finaliser produced: already Y-up, never recentred, and
 * never carrying a fit scale. Nothing here touches its transform — the camera moves to suit
 * the model, not the other way round.
 *
 * Keyed on model.id by the caller so React unmounts the old graph rather than trying to
 * reconcile two unrelated object trees.
 */
export function ModelRoot({ model }: Props) {
  return <primitive object={model.object} />;
}
