import { useEffect, useMemo, useState } from 'react';
import type { BufferGeometry, Mesh, Object3D } from 'three';
import { LIMITS } from '../lib/limits';

type BvhGeometry = BufferGeometry & {
  boundsTree?: unknown;
  computeBoundsTree?: (options?: Record<string, unknown>) => void;
  disposeBoundsTree?: () => void;
};

export type BvhStatus = 'idle' | 'building' | 'ready' | 'skipped' | 'too-large';

interface Plan {
  readonly verdict: 'build' | 'skipped' | 'too-large';
  readonly meshes: readonly Mesh[];
}

/** Decided synchronously from the model, so it is derived rather than stored. */
function planFor(root: Object3D | null): Plan {
  if (!root) return { verdict: 'skipped', meshes: [] };
  const meshes: Mesh[] = [];
  let total = 0;
  root.traverse((o) => {
    const mesh = o as Mesh & { isMesh?: boolean };
    const positions = mesh.geometry?.attributes?.position;
    if (!mesh.isMesh || !positions) return;
    const triangles = mesh.geometry.index ? mesh.geometry.index.count / 3 : positions.count / 3;
    total += triangles;
    // Below the threshold a linear scan is already sub-millisecond, so an index would cost
    // more to build than it could ever save.
    if (triangles >= LIMITS.bvhMinTriangles) meshes.push(mesh);
  });
  if (meshes.length === 0) return { verdict: 'skipped', meshes };
  // A tree runs 30-40 bytes per triangle, so past this it is hundreds of megabytes.
  if (total > LIMITS.bvhMaxTriangles) return { verdict: 'too-large', meshes: [] };
  return { verdict: 'build', meshes };
}

/**
 * A bounding volume hierarchy for picking, built lazily.
 *
 * Without one, raycasting is a linear scan over every triangle: roughly 50-200 ms per ray on
 * a 2M-triangle mesh, which is a hard freeze at pointer rate. With one it is microseconds.
 *
 * Built here rather than via drei's <Bvh> for three reasons: that component's effect has an
 * empty dependency list so it never indexes a model that mounts later, it defaults to the
 * slowest build strategy, and it sets firstHitOnly on the SHARED raycaster.
 */
export function useMeshBvh(root: Object3D | null, enabled: boolean): BvhStatus {
  const plan = useMemo(() => planFor(root), [root]);
  const [builtFor, setBuiltFor] = useState<Object3D | null>(null);

  useEffect(() => {
    if (!enabled || !root || plan.verdict !== 'build') return;

    let cancelled = false;
    const indexed: BvhGeometry[] = [];

    void (async () => {
      // Dynamic, so ~90 kB stays out of the bundle for everyone who never measures.
      const { computeBoundsTree, disposeBoundsTree, CENTER } = await import('three-mesh-bvh');
      if (cancelled) return;
      for (const mesh of plan.meshes) {
        const g = mesh.geometry as BvhGeometry;
        if (g.boundsTree) continue;
        g.computeBoundsTree = computeBoundsTree as never;
        g.disposeBoundsTree = disposeBoundsTree as never;
        g.computeBoundsTree({
          // CENTER builds several times faster than SAH, whose better query quality is
          // irrelevant at one ray per click.
          strategy: CENTER,
          // Avoids reordering the index buffer, which would scramble geometry.groups.
          indirect: true,
        });
        indexed.push(g);
      }
      if (!cancelled) setBuiltFor(root);
    })();

    return () => {
      cancelled = true;
      for (const g of indexed) g.disposeBoundsTree?.();
    };
  }, [root, enabled, plan]);

  if (!enabled) return 'idle';
  if (plan.verdict !== 'build') return plan.verdict;
  return builtFor === root ? 'ready' : 'building';
}
