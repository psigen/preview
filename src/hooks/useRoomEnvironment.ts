import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Image-based lighting with no network access.
 *
 * drei's <Environment preset> downloads an HDRI from a CDN, which this app forbids — see
 * CLAUDE.md. RoomEnvironment is a procedural scene built in code, prefiltered once through
 * PMREMGenerator into a small cube map. It costs ~10-20 ms and negligible VRAM.
 *
 * Chosen over a hand-built three-point rig because it is omnidirectional: top and bottom
 * views are never black, which is the most common failure of a fixed light setup, and a
 * metallic glTF and a flat grey STL both look correct with no per-model tuning.
 */
export function useRoomEnvironment(intensity = 0.6): void {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);

    scene.environment = target.texture;
    scene.environmentIntensity = intensity;
    invalidate();

    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      room.traverse((o) => {
        const node = o as { geometry?: { dispose(): void }; material?: { dispose(): void } };
        node.geometry?.dispose();
        node.material?.dispose();
      });
    };
  }, [gl, scene, intensity, invalidate]);
}
