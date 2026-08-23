import type { OcctMesh, OcctNode, OcctResult } from 'occt-import-js';
import type { MaterialPayload, MeshPayload, NodePayload, ScenePayload } from '../../asset/payload';

/**
 * OCCT's JSON result, flattened into a ScenePayload.
 *
 * Pure and wasm-free on purpose: this is the half of the CAD path with all the fiddly
 * structure — hierarchy flattening, per-face colours, missing normals — and keeping it
 * separate means it is tested in milliseconds against hand-written fixtures rather than
 * behind an 8 MB module.
 */

/** Colours arrive as 0..1 triples that may be shared, so materials are deduplicated. */
class MaterialTable {
  private readonly index = new Map<string, number>();
  readonly list: MaterialPayload[] = [];

  intern(color: readonly [number, number, number] | undefined): number {
    const key = color ? color.map((c) => c.toFixed(5)).join(',') : 'default';
    const existing = this.index.get(key);
    if (existing !== undefined) return existing;
    const id = this.list.length;
    this.index.set(key, id);
    this.list.push({
      name: key,
      ...(color ? { color: [color[0], color[1], color[2]] as const } : {}),
      // CAD exports have unreliable winding, and a solid seen from inside should still read
      // as a solid rather than vanishing.
      doubleSided: true,
      metalness: 0.1,
      roughness: 0.55,
    });
    return id;
  }
}

function convertMesh(mesh: OcctMesh, materials: MaterialTable): MeshPayload | null {
  const position = mesh.attributes?.position?.array;
  const index = mesh.index?.array;
  if (!position || position.length < 9 || !index || index.length < 3) return null;

  const payload: MeshPayload = {
    name: mesh.name || 'solid',
    positions: Float32Array.from(position),
    ...(mesh.attributes.normal ? { normals: Float32Array.from(mesh.attributes.normal.array) } : {}),
    indices: Uint32Array.from(index),
    topology: 'triangles',
  };

  /**
   * brep_faces maps each original B-rep face onto a run of triangles, which is what lets a
   * multi-coloured assembly keep its per-face colours. The ranges are in TRIANGLES, while a
   * three geometry group is in INDICES, so each bound is multiplied by three.
   */
  const faces = mesh.brep_faces ?? [];
  const coloured = faces.filter((f) => f.color);
  if (coloured.length > 0) {
    const groups = faces.map((face) => ({
      start: face.first * 3,
      count: (face.last - face.first + 1) * 3,
      materialIndex: materials.intern(face.color ?? mesh.color),
    }));
    return { ...payload, groups };
  }

  return { ...payload, materialIndex: materials.intern(mesh.color) };
}

/** Depth-first walk of OCCT's node tree, flattened into the payload's parent-index form. */
function walk(node: OcctNode, parent: number, nodes: NodePayload[], meshRemap: Map<number, number>): void {
  const self = nodes.length;
  nodes.push({
    name: node.name || (parent === -1 ? 'root' : 'part'),
    parent,
    // OCCT applies every placement itself, so a node carries no transform of its own.
    meshes: (node.meshes ?? []).map((i) => meshRemap.get(i)).filter((i): i is number => i !== undefined),
  });
  for (const child of node.children ?? []) walk(child, self, nodes, meshRemap);
}

export class OcctConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcctConversionError';
  }
}

export function convertOcctResult(result: OcctResult, fileName: string): ScenePayload {
  if (!result.success) {
    throw new OcctConversionError(`The CAD engine could not read "${fileName}".`);
  }

  const materials = new MaterialTable();
  const meshes: MeshPayload[] = [];
  const meshRemap = new Map<number, number>();

  (result.meshes ?? []).forEach((mesh, sourceIndex) => {
    const converted = convertMesh(mesh, materials);
    if (!converted) return; // a degenerate face contributes nothing
    meshRemap.set(sourceIndex, meshes.length);
    meshes.push(converted);
  });

  /**
   * `success: true` does NOT imply geometry. An IGES carrying only curves or wireframe
   * parses cleanly and yields nothing to draw, which is a real case (docs/SPIKES.md S3), so
   * the mesh count has to be checked separately from the success flag.
   */
  if (meshes.length === 0) {
    throw new OcctConversionError(
      `No renderable geometry was found in "${fileName}". ` +
        'It may contain only curves or wireframe rather than surfaces or solids.',
    );
  }

  const nodes: NodePayload[] = [];
  if (result.root) {
    walk(result.root, -1, nodes, meshRemap);
  } else {
    nodes.push({ name: 'root', parent: -1, meshes: meshes.map((_, i) => i) });
  }

  // A hierarchy can attach a mesh to no node at all; hang the orphans off the root so
  // nothing silently disappears.
  const attached = new Set(nodes.flatMap((n) => n.meshes));
  const orphans = meshes.map((_, i) => i).filter((i) => !attached.has(i));
  if (orphans.length > 0) {
    nodes[0] = { ...nodes[0]!, meshes: [...nodes[0]!.meshes, ...orphans] };
  }

  return { nodes, meshes, materials: materials.list };
}
