import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { countsFor, meshPayloadFromGeometry } from '../../asset/fromGeometry';
import { UNITS_UNKNOWN, warn, type LoadWarning } from '../../asset/types';
import type { GeometryPipeline, TranscodeOutput } from '../../registry/types';

/**
 * PLY: ASCII, binary little-endian, or binary big-endian.
 *
 * Big-endian works even though three's loader only names the little-endian format string —
 * it passes the negation straight into DataView.getFloat32(offset, littleEndian).
 *
 * PLY is also the one format here that is routinely a POINT CLOUD rather than a mesh.
 * PLYLoader only calls setIndex when the header declared a face element, so the absence of
 * an index is a reliable signal that there are no faces to draw.
 */
export const plyPipeline: GeometryPipeline = {
  kind: 'geometry',

  async transcode(input, ctx) {
    const started = performance.now();
    ctx.onProgress('Parsing PLY', null);

    const geometry = new PLYLoader().parse(input.primary.bytes);
    ctx.signal.throwIfAborted();

    const isPointCloud = geometry.index === null;
    const warnings: LoadWarning[] = [];
    const mesh = meshPayloadFromGeometry(
      geometry,
      input.primary.name,
      isPointCloud ? 'points' : 'triangles',
    );

    if (isPointCloud) {
      warnings.push(
        warn('no-indices', 'This PLY contains points with no faces, so it is drawn as a point cloud.', 'info'),
      );
    } else if (!mesh.normals) {
      // Common: most PLY writers omit normals. buildScene derives them.
      warnings.push(warn('no-normals', 'No vertex normals in this PLY; they were derived from the faces.', 'info'));
    }

    const meshes = [mesh];
    const output: TranscodeOutput = {
      scene: {
        nodes: [{ name: 'root', parent: -1, meshes: [0] }],
        meshes,
        materials: [{ vertexColors: Boolean(mesh.colors) }],
      },
      units: UNITS_UNKNOWN('PLY files do not record units, so distances are shown in model units.'),
      sourceUpAxis: 'unknown',
      orientation: 'file',
      warnings,
      counts: countsFor(meshes),
      parseMs: performance.now() - started,
    };
    return output;
  },
};
