import { describe, expect, it } from 'vitest';
import { arrange, compose, startSlots } from '../src/game/figures';

describe('compose', () => {
  it('uses as many large figures as possible', () => {
    expect(compose(0)).toEqual([]);
    expect(compose(1)).toEqual([1]);
    expect(compose(2)).toEqual([2]);
    expect(compose(3)).toEqual([2, 1]);
    expect(compose(4)).toEqual([2, 2]);
    expect(compose(5)).toEqual([5]);
    expect(compose(9)).toEqual([5, 2, 2]);
    expect(compose(13)).toEqual([5, 5, 2, 1]);
  });

  it('always adds up to the stack', () => {
    for (let n = 0; n <= 60; n++) {
      const sizes = compose(n);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      // Never two ones or more than two twos: they would be swapped up.
      expect(sizes.filter((s) => s === 1).length).toBeLessThanOrEqual(1);
      expect(sizes.filter((s) => s === 2).length).toBeLessThanOrEqual(2);
    }
  });
});

describe('arrange', () => {
  it('centres a single figure', () => {
    expect(arrange([5])).toEqual([{ size: 5, x: 0, z: 0 }]);
  });

  it('keeps every figure apart and close to the centre', () => {
    for (let n = 1; n <= 40; n++) {
      const placed = arrange(compose(n));
      expect(placed).toHaveLength(compose(n).length);
      for (let i = 0; i < placed.length; i++) {
        const a = placed[i]!;
        expect(Math.hypot(a.x, a.z)).toBeLessThan(0.4);
        for (const b of placed.slice(i + 1))
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.1);
      }
    }
  });

  it('puts the largest figure first, at the back or in the middle', () => {
    const placed = arrange([1, 2, 5]);
    expect(placed.map((p) => p.size)).toEqual([5, 2, 1]);
    expect(placed[0]!.z).toBeLessThan(0);
    expect(arrange(compose(26))[0]).toEqual({ size: 5, x: 0, z: 0 });
  });
});

describe('startSlots', () => {
  it('spreads colours across the area in player order', () => {
    const slots = startSlots([0, 2, 4], 0.7);
    const xs = [0, 2, 4].map((p) => slots.get(p)!.x);
    expect(xs[0]).toBeLessThan(xs[1]!);
    expect(xs[1]).toBeCloseTo(0);
    expect(xs[2]).toBeGreaterThan(xs[1]!);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(0.35);
    expect(startSlots([3], 0.7).get(3)!.x).toBe(0);
  });
});
