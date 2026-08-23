/**
 * The format coverage gate.
 *
 * Every registered format must have a fixture case, and each case must survive the full
 * production path: detect -> pipeline -> buildScene -> finalize. The assertions are the
 * same for every format on purpose, because the point is that one physical object measures
 * the same however it was written down.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { CASES } from './cases';
import { DIAGONAL_ABSTRACT } from './gen/box';
import { makeProbe } from '../src/lib/detect/probe';
import { detectFormat } from '../src/lib/detect/detect';
import { registry } from '../src/lib/registry';
import { DEFAULT_QUALITY } from '../src/lib/registry/types';
import { buildScene } from '../src/lib/asset/payload';
import { computeStats } from '../src/lib/asset/stats';
import { loadAsset, singleFileInput, UnsupportedFormatError } from '../src/lib/load/loadAsset';
import type { Vec3 } from '../src/lib/vec3';
import { primeOcct } from './occt';

// The browser fetches the CAD wasm from public/vendor; Node reads it from node_modules.
// Priming the singleton once here means the pipeline under test needs no special casing.
beforeAll(async () => {
  await primeOcct();
});

/** Build the loader input for a case, wiring up any sidecars it declares. */
function inputFor(testCase: (typeof CASES)[number]) {
  const base = singleFileInput(testCase.fileName, testCase.bytes());
  const declared = testCase.companions?.();
  if (!declared) return base;
  const companions = new Map(
    [...declared].map(([path, bytes]) => [path, { name: path, path, bytes }]),
  );
  return { ...base, companions };
}

const expectVec3Close = (actual: Vec3, want: Vec3, digits = 4) => {
  for (let i = 0; i < 3; i++) expect(actual[i], `component ${i}`).toBeCloseTo(want[i]!, digits);
};

describe('coverage gate', () => {
  it('every registered format has at least one fixture case', () => {
    const covered = new Set(CASES.map((c) => c.format));
    const missing = registry.ids().filter((id) => !covered.has(id));
    expect(missing, 'formats registered with no fixture').toEqual([]);
  });

  it('every fixture case targets a registered format', () => {
    const orphans = CASES.filter((c) => !registry.has(c.format)).map((c) => c.name);
    expect(orphans).toEqual([]);
  });
});

describe.each(CASES)('$name', (testCase) => {
  const load = () => loadAsset(inputFor(testCase));

  it('is detected from its filename', () => {
    const probe = makeProbe(testCase.fileName, testCase.bytes());
    expect(detectFormat(probe).candidates[0]).toBe(testCase.format);
  });

  it.runIf(testCase.strongSniff)('is detected even when renamed to blob.dat', () => {
    const probe = makeProbe('blob.dat', testCase.bytes());
    expect(detectFormat(probe).candidates[0]).toBe(testCase.format);
  });

  it('loads with the expected primitive counts', async () => {
    const model = await load();
    expect(model.format).toBe(testCase.format);
    expect(model.stats.triangles).toBe(testCase.expectTriangles);
    expect(model.stats.points).toBe(testCase.expectPoints);
    expect(model.stats.meshes).toBe(testCase.expectMeshes);
    expect(model.stats.valid).toBe(true);
    model.dispose();
  });

  it('lands in the right place in world space', async () => {
    const model = await load();
    // 6 places, because the metric cases are around 0.01 and 4 would pass on anything.
    expectVec3Close(model.stats.bounds.min, testCase.expectBounds.min, 6);
    expectVec3Close(model.stats.bounds.max, testCase.expectBounds.max, 6);
    model.dispose();
  });

  it('reports its units and source up-axis exactly', async () => {
    const model = await load();
    expect(model.sourceUpAxis).toBe(testCase.expectSourceUpAxis);
    if (testCase.expectMetersPerUnit === null) {
      expect(model.units.known).toBe(false);
    } else {
      expect(model.units.known).toBe(true);
      expect(model.units.known && model.units.metersPerUnit).toBeCloseTo(
        testCase.expectMetersPerUnit,
        12,
      );
    }
    model.dispose();
  });

  /**
   * The invariant the whole design turns on. One physical box, however it was authored,
   * must measure the same. A tolerance rather than equality: the CAD path round-trips
   * through a unit conversion and drifts by ~1e-15.
   */
  it('agrees with every other format on the diagonal', async () => {
    const model = await load();
    const worldDiagonal = Math.hypot(...model.stats.size);
    const measured = model.units.known
      ? worldDiagonal * model.units.metersPerUnit
      : worldDiagonal * 1e-3; // unitless fixtures carry the raw millimetre numbers
    const expected = DIAGONAL_ABSTRACT * 1e-3;

    /**
     * RELATIVE, not absolute. Positions are Float32, whose precision is proportional to
     * magnitude: a metre-scale glTF stores 0.03 as 0.029999999329447746, which is 8e-10 off
     * in absolute terms but only 2e-8 in relative terms. An absolute tolerance would pass
     * for millimetre-scale fixtures — where 10, 20 and 30 are exactly representable — and
     * fail for metre-scale ones purely because of where the decimal point sits.
     */
    expect(Math.abs(measured - expected) / expected).toBeLessThan(1e-6);
    model.dispose();
  });

  /** Requirement 5: nothing may bake a fit or normalisation scale, and nothing may recentre. */
  it('has no fit scale and was never recentred', async () => {
    const model = await load();
    const scale = new Vector3();
    model.worldFromFile.decompose(new Vector3(), new Quaternion(), scale);
    expect(scale.x).toBeCloseTo(scale.y, 12);
    expect(scale.y).toBeCloseTo(scale.z, 12);
    expect(scale.x).toBeCloseTo(testCase.expectBakedScale, 12);
    expect(model.object.position.lengthSq()).toBe(0);
    model.dispose();
  });

  it('raises exactly the expected warnings', async () => {
    const model = await load();
    expect([...model.warnings.map((w) => w.code)].sort()).toEqual(
      [...testCase.expectWarnings].sort(),
    );
    model.dispose();
  });

  it('frees every geometry exactly once on dispose', async () => {
    const model = await load();
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    model.object.traverse((o) => {
      const g = (o as { geometry?: { dispose: () => void } }).geometry;
      if (g) spies.push(vi.spyOn(g, 'dispose'));
    });
    expect(spies.length).toBeGreaterThan(0);
    model.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });
});

/**
 * A pipeline reports its own counts in TranscodeOutput.counts, and computeStats derives them
 * independently by walking the graph buildScene produced. Nothing in the app reads the
 * former — but making the two agree is a genuine cross-check: if the payload and the scene
 * built from it disagree about how many triangles exist, one of them is wrong.
 */
describe('payload counts agree with the built scene', () => {
  const geometryCases = CASES.filter((c) => registry.get(c.format));

  it.each(geometryCases)('$name', async (testCase) => {
    const descriptor = registry.get(testCase.format)!;
    const pipeline = await descriptor.pipeline();
    if (pipeline.kind !== 'geometry') return;

    const out = await pipeline.transcode(singleFileInput(testCase.fileName, testCase.bytes()), {
      onProgress: () => {},
      warn: () => {},
      signal: new AbortController().signal,
      quality: DEFAULT_QUALITY,
    });
    const derived = computeStats(buildScene(out.scene), {
      bytes: 0,
      parseMs: 0,
      animations: 0,
      sourceSize: [0, 0, 0],
    });

    expect(out.counts.triangles).toBe(derived.triangles);
    expect(out.counts.vertices).toBe(derived.vertices);
    expect(out.counts.points).toBe(derived.points);
    expect(out.counts.meshes).toBe(derived.meshes);
    // and both must match what the case declares
    expect(out.counts.triangles).toBe(testCase.expectTriangles);
    expect(out.counts.points).toBe(testCase.expectPoints);
  });
});

describe('orchestration', () => {
  it('reports an unrecognised file clearly', async () => {
    const bytes = new TextEncoder().encode('just some prose, not a model at all\n')
      .buffer as ArrayBuffer;
    await expect(loadAsset(singleFileInput('notes.txt', bytes))).rejects.toThrow(
      UnsupportedFormatError,
    );
  });

  it('names the format when it is recognised but not implemented yet', async () => {
    // 3MF is detected confidently, but has no pipeline in this build.
    const threemf = (await import('./gen/writers')).threemf('millimeter');
    await expect(loadAsset(singleFileInput('box.3mf', threemf))).rejects.toThrow(
      /does not support yet/i,
    );
  });

  it('honours an explicit format hint over the bytes', async () => {
    const ply = CASES.find((c) => c.format === 'ply')!;
    // Hinted as STL, the PLY bytes cannot parse, so the load fails rather than silently
    // falling back — a hint is the user overriding us, and must be obeyed.
    await expect(
      loadAsset(singleFileInput('mislabelled.dat', ply.bytes(), 'stl')),
    ).rejects.toThrow();
  });

  it('assigns increasing ids to successive loads', async () => {
    const c = CASES[0]!;
    const a = await loadAsset(singleFileInput(c.fileName, c.bytes()));
    const b = await loadAsset(singleFileInput(c.fileName, c.bytes()));
    expect(b.id).toBeGreaterThan(a.id);
    a.dispose();
    b.dispose();
  });

  it('reports parse time and source size', async () => {
    const c = CASES[0]!;
    const bytes = c.bytes();
    const model = await loadAsset(singleFileInput(c.fileName, bytes));
    expect(model.stats.bytes).toBe(bytes.byteLength);
    expect(model.stats.parseMs).toBeGreaterThanOrEqual(0);
    model.dispose();
  });
});

/**
 * Requirement 7, enforced on the source text rather than on behaviour: this is the
 * difference between a ~300 kB initial bundle and one that eagerly pulls in three, every
 * loader and an 8 MB wasm module.
 */
describe('lazy loading discipline', () => {
  const formatsDir = join(import.meta.dirname, '..', 'src', 'lib', 'formats');

  it('no descriptor statically imports three, a loader, or wasm', () => {
    const offenders: string[] = [];
    for (const dir of readdirSync(formatsDir)) {
      const file = join(formatsDir, dir, 'descriptor.ts');
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const line of source.split('\n')) {
        // `import type` is erased at build time and costs nothing at runtime.
        if (/^\s*import\s+type\b/.test(line)) continue;
        if (/^\s*import\b.*\bfrom\s+['"](three|three\/addons|occt-import-js)/.test(line)) {
          offenders.push(`${dir}/descriptor.ts: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every registered format resolves its pipeline lazily', async () => {
    for (const descriptor of registry.list()) {
      const pipeline = await descriptor.pipeline();
      expect(['geometry', 'scene']).toContain(pipeline.kind);
    }
  });
});
