/**
 * Turning a drop into a load request.
 *
 * A drop is a LIST of files, never one: the formats that matter here routinely come with
 * sidecars — a .gltf beside its .bin and textures, an .obj beside its .mtl, a USD layer
 * beside the layers it references. So the shape is always "one primary plus companions",
 * and the only question is which file is the primary.
 */
import { formatsForExtension } from './detect/detect';
import { extensionOf } from './detect/probe';
import type { FormatId } from './format-id';

export interface DroppedFile {
  /** Path relative to the drop root, lower-cased and forward-slashed. */
  readonly path: string;
  readonly file: File;
}

/**
 * Which format wins when a drop contains several loadable files.
 *
 * Ranked by how likely a file is to be the thing the user meant rather than a dependency of
 * it: a scene format outranks a single mesh, and a mesh outranks CAD only because a folder
 * containing both is almost always a converted export where the mesh is the preview.
 */
const FORMAT_RANK: Record<FormatId, number> = {
  usd: 90,
  gltf: 80,
  fbx: 70,
  '3mf': 60,
  obj: 50,
  stl: 40,
  ply: 40,
  step: 30,
  iges: 30,
  brep: 20,
};

export function hasFiles(dataTransfer: Pick<DataTransfer, 'types'> | null | undefined): boolean {
  if (!dataTransfer) return false;
  // `types` is a DOMStringList in some engines, so avoid Array.prototype.includes on it.
  for (const t of Array.from(dataTransfer.types)) if (t === 'Files') return true;
  return false;
}

/**
 * Normalise a path from a folder drop into a stable relative key.
 *
 * Companion resolution matches on these, so a leading './', a Windows separator or a
 * percent-encoded space must not produce a miss.
 */
export function normalizePath(raw: string): string {
  let path = raw.replace(/\\/g, '/').trim();
  try {
    path = decodeURIComponent(path);
  } catch {
    /* a stray % is not an escape; keep the literal text */
  }
  path = path.replace(/^\.\//, '').replace(/^\/+/, '');
  return path.toLowerCase();
}

/**
 * Drop the shared leading directory.
 *
 * Dropping a folder gives every entry a `myModel/` prefix that the asset's own relative
 * references do not have, so the two would never match. Only strips when EVERY file shares
 * the segment, and never strips the last remaining segment.
 */
export function stripCommonRoot(paths: readonly string[]): (path: string) => string {
  if (paths.length === 0) return (p) => p;
  const split = paths.map((p) => p.split('/'));
  if (split.some((s) => s.length < 2)) return (p) => p;

  let prefix = 0;
  for (;;) {
    const segment = split[0]![prefix];
    if (segment === undefined) break;
    // Never consume the filename itself.
    if (split.some((s) => s.length <= prefix + 1)) break;
    if (split.some((s) => s[prefix] !== segment)) break;
    prefix += 1;
  }
  return prefix === 0 ? (p) => p : (p) => p.split('/').slice(prefix).join('/');
}

export interface Selection {
  /** The file to open, or null when nothing in the drop is loadable. */
  readonly primary: DroppedFile | null;
  /** Everything else, keyed by normalised path, for sidecar resolution. */
  readonly companions: ReadonlyMap<string, DroppedFile>;
  /** Loadable files that lost to the primary — offered as an "open instead" list. */
  readonly alternatives: readonly DroppedFile[];
}

/**
 * Elect the primary file from a drop.
 *
 * Ties are broken by shallowest path, then shortest name, then alphabetically: a top-level
 * `scene.gltf` should win over `textures/backup/scene.gltf`, and the order must be stable so
 * the same drop always opens the same file.
 */
export function selectPrimary(files: readonly DroppedFile[]): Selection {
  const scored = files
    .map((f) => {
      const formats = formatsForExtension(extensionOf(f.path));
      const rank = formats.reduce((best, id) => Math.max(best, FORMAT_RANK[id] ?? 0), -1);
      return { file: f, rank };
    })
    .filter((s) => s.rank >= 0);

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    const depthA = a.file.path.split('/').length;
    const depthB = b.file.path.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    if (a.file.path.length !== b.file.path.length) return a.file.path.length - b.file.path.length;
    return a.file.path.localeCompare(b.file.path);
  });

  const primary = scored[0]?.file ?? null;
  const companions = new Map<string, DroppedFile>();
  for (const f of files) {
    if (f === primary) continue;
    companions.set(f.path, f);
  }

  return {
    primary,
    companions,
    alternatives: scored.slice(1).map((s) => s.file),
  };
}
