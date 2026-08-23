import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { countsFor, meshPayloadFromGeometry } from '../../asset/fromGeometry';
import { UNITS_UNKNOWN, warn, type LoadWarning } from '../../asset/types';
import type { GeometryPipeline, TranscodeOutput } from '../../registry/types';

/**
 * STL: a flat triangle soup, ASCII or binary.
 *
 * three's STLLoader handles both variants and the ASCII/binary decision itself, using the
 * same 84 + 50n length check our sniffer uses, so this pipeline never has to care which it
 * was given. It also understands the two common per-facet colour conventions.
 */
export const stlPipeline: GeometryPipeline = {
  kind: 'geometry',

  async transcode(input, ctx) {
    const started = performance.now();
    ctx.onProgress('Parsing STL', null);

    const geometry = new STLLoader().parse(input.primary.bytes);
    ctx.signal.throwIfAborted();

    const warnings: LoadWarning[] = [];
    const mesh = meshPayloadFromGeometry(geometry, input.primary.name, 'triangles');

    // No no-normals branch: STLLoader sets the normal attribute on both its binary and
    // ASCII paths, and the format requires a facet normal on every facet, so it cannot fire.
    if (mesh.colors) {
      // Only some writers emit these, via a non-standard header extension.
      warnings.push(
        warn('unsupported-feature', 'Per-facet colours were found and applied.', 'info'),
      );
    }

    const meshes = [mesh];
    const output: TranscodeOutput = {
      scene: {
        nodes: [{ name: 'root', parent: -1, meshes: [0] }],
        meshes,
        materials: [{ vertexColors: Boolean(mesh.colors) }],
      },
      units: UNITS_UNKNOWN('STL files do not record units, so distances are shown in model units.'),
      // STL has no orientation field at all. Most CAD exporters write Z-up content, but the
      // file does not say so, and guessing would rotate the many STLs that are not.
      sourceUpAxis: 'unknown',
      orientation: 'file',
      warnings,
      counts: countsFor(meshes),
      parseMs: performance.now() - started,
    };
    return output;
  },
};
