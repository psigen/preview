import { describe, expect, it } from 'vitest';
import { LIMITS, assessFileSize, assessModel } from './limits';

describe('LIMITS', () => {
  it('orders the triangle thresholds coherently', () => {
    expect(LIMITS.bvhMinTriangles).toBeLessThan(LIMITS.softTriangles);
    expect(LIMITS.softTriangles).toBeLessThan(LIMITS.bvhMaxTriangles);
    expect(LIMITS.bvhMaxTriangles).toBeLessThan(LIMITS.hardTriangles);
  });

  it('keeps the drag threshold well under the snap radius', () => {
    // Otherwise a click that snaps would also register as a drag and be discarded.
    expect(LIMITS.dragPx).toBeLessThan(LIMITS.snapPx);
  });
});

describe('assessFileSize', () => {
  it('passes a normal file silently', () => {
    expect(assessFileSize(10 * 1024 * 1024)).toEqual({ tooBig: false, message: null });
  });

  it('warns before a file large enough to kill the tab', () => {
    const r = assessFileSize(480 * 1024 * 1024);
    expect(r.tooBig).toBe(true);
    expect(r.message).toContain('480 MB');
    // The message must offer a way forward, not just refuse.
    expect(r.message).toMatch(/anyway|decimated/i);
  });

  it('is exclusive at the threshold', () => {
    expect(assessFileSize(LIMITS.warnFileBytes - 1).tooBig).toBe(false);
    expect(assessFileSize(LIMITS.warnFileBytes).tooBig).toBe(true);
  });
});

describe('assessModel', () => {
  const small = 5_000;
  const mid = 100_000;

  it('is silent and BVH-less for a tiny model', () => {
    const a = assessModel(small, 1024);
    expect(a.level).toBe('ok');
    expect(a.messages).toEqual([]);
    expect(a.useBvh).toBe(false); // linear raycast is already sub-millisecond here
    expect(a.disableHover).toBe(false);
  });

  it('builds a BVH once a model is big enough to be worth indexing', () => {
    expect(assessModel(LIMITS.bvhMinTriangles - 1, 0).useBvh).toBe(false);
    expect(assessModel(LIMITS.bvhMinTriangles, 0).useBvh).toBe(true);
    expect(assessModel(mid, 0).useBvh).toBe(true);
  });

  it('warns but stays fully featured past the soft budget', () => {
    const a = assessModel(LIMITS.softTriangles + 1, 0);
    expect(a.level).toBe('warn');
    expect(a.messages.join(' ')).toMatch(/interaction may be slow/i);
    expect(a.disableHover).toBe(false);
    expect(a.useBvh).toBe(true);
  });

  it('stops indexing, and so stops hovering, past the BVH ceiling', () => {
    const a = assessModel(LIMITS.bvhMaxTriangles + 1, 0);
    expect(a.useBvh).toBe(false);
    expect(a.disableHover).toBe(true);
    expect(a.messages.join(' ')).toMatch(/picking/i);
  });

  it('degrades honestly past the hard budget instead of pretending', () => {
    const a = assessModel(LIMITS.hardTriangles + 1, 0);
    expect(a.level).toBe('heavy');
    expect(a.disableHover).toBe(true);
    // It must say what still works, not only what does not.
    expect(a.messages.join(' ')).toMatch(/click/i);
  });

  it('mentions a large source file separately from triangle count', () => {
    const a = assessModel(small, 300 * 1024 * 1024);
    expect(a.messages.join(' ')).toMatch(/300 MB/);
  });

  it('formats large counts readably', () => {
    expect(assessModel(2_500_000, 0).messages.join(' ')).toContain('2,500,000');
  });

  it('handles a zero-triangle model without warning', () => {
    const a = assessModel(0, 0);
    expect(a.level).toBe('ok');
    expect(a.useBvh).toBe(false);
  });
});
