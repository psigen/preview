import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { DIAGONAL_ABSTRACT, DIAGONAL_M } from '../../../test/gen/box';
import { buildScene } from '../asset/payload';
import { Z_UP_TO_Y_UP_X_ROTATION, upAxisRotationX } from '../asset/orient';
import { UNITS_DECLARED, UNITS_UNKNOWN, type RawAsset } from '../asset/types';
import { stubPayload, stubRawAsset } from '../../../test/gen/stubAsset';
import { finalize, type FinalizeMeta } from './finalize';

const META: FinalizeMeta = { id: 1, name: 'test', format: 'stl', bytes: 123, parseMs: 4 };
const fin = (raw: RawAsset, meta: Partial<FinalizeMeta> = {}) => finalize(raw, { ...META, ...meta });

const diagonalOf = (size: readonly [number, number, number]) => Math.hypot(...size);

describe('upAxisRotationX', () => {
  it('rotates only a Z-up file the loader has not already handled', () => {
    expect(upAxisRotationX('file', 'Z')).toBe(Z_UP_TO_Y_UP_X_ROTATION);
    expect(upAxisRotationX('file', 'Y')).toBe(0);
    expect(upAxisRotationX('file', 'unknown')).toBe(0);
  });

  it('does not rotate a loader that already produced Y-up — three USDLoader does this', () => {
    expect(upAxisRotationX('y-up', 'Z')).toBe(0);
    expect(upAxisRotationX('y-up', 'Y')).toBe(0);
  });
});

describe('the wrapper', () => {
  it('always exists, even when no rotation is needed', () => {
    const model = fin(stubRawAsset({ sourceUpAxis: 'Y' }));
    expect(model.object).toBeInstanceOf(Group);
    expect(model.object.children).toHaveLength(1);
    expect(model.object.rotation.x).toBe(0);
  });

  it('never modifies the plugin root it wraps', () => {
    const raw = stubRawAsset({ sourceUpAxis: 'Z' });
    const before = raw.object.matrix.clone();
    const model = fin(raw);
    expect(raw.object.matrix.equals(before)).toBe(true);
    expect(model.object.rotation.x).toBeCloseTo(Z_UP_TO_Y_UP_X_ROTATION, 12);
  });

  it('leaves the app free to transform the wrapper without touching a loader unit scale', () => {
    // A loader that baked metersPerUnit into its own root, as USDLoader does.
    const inner = buildScene(stubPayload([10, 20, 30]));
    inner.scale.setScalar(0.001);
    const model = fin({ object: inner, units: UNITS_DECLARED(1), sourceUpAxis: 'Y', orientation: 'y-up' });
    model.object.scale.setScalar(5); // the app scales the wrapper
    expect(inner.scale.x).toBe(0.001); // the baked scale is untouched
  });
});

describe('no fit or normalisation scale is ever baked in', () => {
  it('leaves worldFromFile with a uniform, unit scale and no translation', () => {
    const model = fin(stubRawAsset({ sourceUpAxis: 'Y' }));
    const scale = new Vector3();
    model.worldFromFile.decompose(new Vector3(), new Quaternion(), scale);
    expect(scale.x).toBeCloseTo(1, 12);
    expect(scale.y).toBeCloseTo(scale.x, 12);
    expect(scale.z).toBeCloseTo(scale.x, 12);
    expect(model.object.position.lengthSq()).toBe(0); // never recentred
  });

  it('reports a loader-baked unit scale rather than hiding it', () => {
    const inner = buildScene(stubPayload([10, 20, 30]));
    inner.scale.setScalar(0.001);
    const model = fin({ object: inner, units: UNITS_DECLARED(1), sourceUpAxis: 'Y', orientation: 'y-up' });
    const scale = new Vector3();
    model.worldFromFile.decompose(new Vector3(), new Quaternion(), scale);
    expect(scale.x).toBeCloseTo(0.001, 12);
    // and the world-space size reflects it
    expect(diagonalOf(model.stats.size)).toBeCloseTo(DIAGONAL_M, 12);
  });

  it('worldFromFile round-trips a file-space point into world space', () => {
    const model = fin(stubRawAsset({ sourceUpAxis: 'Z' }));
    // (x, y, z) -> (x, z, -y) under the -90 degree X rotation.
    const p = new Vector3(1, 2, 3).applyMatrix4(model.worldFromFile);
    expect(p.x).toBeCloseTo(1, 9);
    expect(p.y).toBeCloseTo(3, 9);
    expect(p.z).toBeCloseTo(-2, 9);
    // And the inverse gives a file-space readout back.
    const back = p.clone().applyMatrix4(new Matrix4().copy(model.worldFromFile).invert());
    expect(back.x).toBeCloseTo(1, 9);
    expect(back.y).toBeCloseTo(2, 9);
    expect(back.z).toBeCloseTo(3, 9);
  });
});

/**
 * The invariant the whole design turns on: one physical box must measure the same however
 * it was authored. A rotation is an isometry, so up-axis correction cannot change it.
 */
describe('the canonical diagonal survives orientation and units', () => {
  it('is identical for a Y-up and a Z-up source', () => {
    const yUp = fin(stubRawAsset({ extents: [10, 20, 30], sourceUpAxis: 'Y' }));
    // A Z-up file puts the physical height on Z, so its extents are authored Y/Z-swapped.
    const zUp = fin(stubRawAsset({ extents: [10, 30, 20], sourceUpAxis: 'Z' }));

    expect(yUp.stats.size[0]).toBeCloseTo(10, 6);
    expect(yUp.stats.size[1]).toBeCloseTo(20, 6);
    expect(yUp.stats.size[2]).toBeCloseTo(30, 6);
    // After the rotation the Z-up model presents the same world extents.
    expect(zUp.stats.size[0]).toBeCloseTo(10, 6);
    expect(zUp.stats.size[1]).toBeCloseTo(20, 6);
    expect(zUp.stats.size[2]).toBeCloseTo(30, 6);

    expect(diagonalOf(zUp.stats.size)).toBeCloseTo(diagonalOf(yUp.stats.size), 9);
  });

  it('converts to the same physical length in metres', () => {
    for (const upAxis of ['Y', 'Z'] as const) {
      const extents: [number, number, number] = upAxis === 'Z' ? [10, 30, 20] : [10, 20, 30];
      const model = fin(stubRawAsset({ extents, sourceUpAxis: upAxis, metersPerUnit: 0.001 }));
      const worldDiagonal = diagonalOf(model.stats.size);
      expect(worldDiagonal).toBeCloseTo(DIAGONAL_ABSTRACT, 6);
      expect(model.units.known && worldDiagonal * model.units.metersPerUnit).toBeCloseTo(DIAGONAL_M, 12);
    }
  });

  it('is unchanged when the same shape declares no units', () => {
    const declared = fin(stubRawAsset({ metersPerUnit: 0.001 }));
    const abstract = fin(stubRawAsset({ metersPerUnit: null }));
    expect(diagonalOf(abstract.stats.size)).toBeCloseTo(diagonalOf(declared.stats.size), 12);
  });
});

describe('warnings', () => {
  it('explains itself when a format declares no units', () => {
    const model = fin(stubRawAsset({ metersPerUnit: null }));
    const w = model.warnings.find((x) => x.code === 'units-unknown');
    expect(w?.severity).toBe('info');
    expect(w?.message).toMatch(/units/i);
  });

  it('says nothing about units when they are declared', () => {
    expect(fin(stubRawAsset()).warnings.some((w) => w.code === 'units-unknown')).toBe(false);
  });

  it('flags an unknown up axis and points at the toggle', () => {
    const model = fin(stubRawAsset({ sourceUpAxis: 'unknown' }));
    const w = model.warnings.find((x) => x.code === 'up-axis-unknown');
    expect(w?.message).toMatch(/toggle/i);
  });

  it('reports a file that parsed but holds no renderable geometry', () => {
    // Real case: an IGES carrying only curves returns success with zero meshes (SPIKES S3).
    const model = fin({
      object: new Group(),
      units: UNITS_DECLARED(1),
      sourceUpAxis: 'Y',
      orientation: 'file',
    });
    const w = model.warnings.find((x) => x.code === 'degenerate-geometry');
    expect(w?.severity).toBe('error');
    expect(w?.message).toMatch(/no renderable geometry/i);
  });

  it('distinguishes NaN geometry from no geometry', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, NaN, 1, 2]), 3));
    const root = new Group();
    root.add(new Mesh(g, new MeshBasicMaterial()));
    const model = fin({ object: root, units: UNITS_DECLARED(1), sourceUpAxis: 'Y', orientation: 'file' });
    expect(model.warnings.map((w) => w.code)).toContain('non-finite-geometry');
    expect(model.warnings.map((w) => w.code)).not.toContain('degenerate-geometry');
  });

  it('preserves warnings the plugin already raised', () => {
    const raw: RawAsset = {
      ...stubRawAsset(),
      warnings: [{ code: 'missing-companion', message: 'box.bin not found', severity: 'warning' }],
    };
    expect(fin(raw).warnings.some((w) => w.code === 'missing-companion')).toBe(true);
  });
});

describe('metadata and disposal', () => {
  it('carries the supplied identity and timing through', () => {
    const model = fin(stubRawAsset(), { id: 7, name: 'part.stl', format: 'step', bytes: 999 });
    expect(model.id).toBe(7);
    expect(model.name).toBe('part.stl');
    expect(model.format).toBe('step');
    expect(model.stats.bytes).toBe(999);
  });

  it('frees geometries and materials, and calls the plugin hook', () => {
    const pluginDispose = vi.fn();
    const raw: RawAsset = { ...stubRawAsset(), dispose: pluginDispose };
    const model = fin(raw);

    const geometries: { dispose: () => void }[] = [];
    model.object.traverse((o) => {
      const g = (o as { geometry?: { dispose: () => void } }).geometry;
      if (g) geometries.push(g);
    });
    const spies = geometries.map((g) => vi.spyOn(g, 'dispose'));
    expect(spies.length).toBeGreaterThan(0);

    model.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    expect(pluginDispose).toHaveBeenCalledTimes(1);
  });

  it('is idempotent, because StrictMode and an explicit replace may both call it', () => {
    const pluginDispose = vi.fn();
    const model = fin({ ...stubRawAsset(), dispose: pluginDispose });
    model.dispose();
    model.dispose();
    model.dispose();
    expect(pluginDispose).toHaveBeenCalledTimes(1);
  });
});

describe('the stub asset helper', () => {
  it('produces the canonical box through the production path', () => {
    const model = fin(stubRawAsset());
    expect(model.stats.triangles).toBe(12);
    expect(model.stats.meshes).toBe(1);
    expect(model.stats.hasNormals).toBe(true);
    expect(model.stats.valid).toBe(true);
    expect(model.stats.bounds.min).toEqual([0, 0, 0]);
  });

  it('reports abstract units when asked to', () => {
    expect(fin(stubRawAsset({ metersPerUnit: null })).units.known).toBe(false);
  });
});

describe('units contract', () => {
  it('UNITS_UNKNOWN and UNITS_DECLARED build the discriminated shapes', () => {
    const unknown = UNITS_UNKNOWN('no units here');
    expect(unknown.known).toBe(false);
    expect(unknown.known === false && unknown.reason).toBe('no units here');

    const declared = UNITS_DECLARED(0.001, 'mm');
    expect(declared.known).toBe(true);
    expect(declared.known === true && declared.metersPerUnit).toBe(0.001);
    expect(declared.known === true && declared.sourceUnit).toBe('mm');
  });
});
