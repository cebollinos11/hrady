import { legalActions, validateAction, type Action } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { scenario } from '../../engine/test/fixtures';
import { candidates } from '../src';

const key = (a: Action) =>
  a.type === 'attackField'
    ? JSON.stringify({
        ...a,
        contributions: [...a.contributions].sort((x, y) => (x.from < y.from ? -1 : 1)),
      })
    : JSON.stringify(a);

const fields = (actions: Action[]) =>
  actions.filter((a): a is Extract<Action, { type: 'attackField' }> => a.type === 'attackField');

describe('candidates', () => {
  it('only rolls at the start of a turn', () => {
    const state = { ...scenario(), phase: 'roll' as const, mp: 0, roll: null };
    expect(candidates(state)).toEqual([{ type: 'roll', player: 0 }]);
  });

  it('are legal actions, ending the turn included', () => {
    const state = scenario({
      knights: { a: { 0: 4 }, c: { 0: 3 }, f: { 0: 2 }, b: { 1: 5 }, d: { 0: 6 }, keep: { 2: 1 } },
      castles: { keep: { owner: 2 } },
    });
    const legal = new Set(legalActions(state, 0).map(key));
    const list = candidates(state);
    for (const a of list) {
      expect(validateAction(state, a)).toBeNull();
      expect(legal.has(key(a))).toBe(true);
    }
    expect(list.at(-1)).toEqual({ type: 'endTurn', player: 0 });
    expect(list.some((a) => a.type === 'attackCastle' && a.castle === 'tower')).toBe(true);
    expect(list.some((a) => a.type === 'attackCastle' && a.castle === 'keep')).toBe(true);
  });

  it('move whole stacks, all but one, or one knight', () => {
    const state = scenario({ knights: { a: { 0: 5 } } });
    const toB = candidates(state).filter((a) => a.type === 'move' && a.to === 'b');
    expect(toB.map((a) => (a.type === 'move' ? a.count : 0))).toEqual([5, 4, 1]);
    const all = candidates(state, { allCounts: true }).filter(
      (a) => a.type === 'move' && a.to === 'b',
    );
    expect(all).toHaveLength(5);
  });

  it('attack a field all-in and with the smallest winning force', () => {
    const state = scenario({ knights: { a: { 0: 4 }, c: { 0: 3 }, b: { 1: 4 } } });
    const attacks = fields(candidates(state)).map((a) => a.contributions);
    expect(attacks).toContainEqual([
      { from: 'a', count: 4 },
      { from: 'c', count: 3 },
    ]);
    expect(attacks).toContainEqual([
      { from: 'a', count: 4 },
      { from: 'c', count: 1 },
    ]);
    // Neither stack wins alone.
    expect(attacks.every((c) => c.length === 2)).toBe(true);
  });

  it('stay few with big stacks, unlike the full legal list', () => {
    const state = scenario({ knights: { a: { 0: 30 }, c: { 0: 30 }, f: { 0: 30 }, b: { 1: 2 } } });
    const legal = fields(legalActions(state, 0)).length;
    const mine = fields(candidates(state)).length;
    expect(legal).toBeGreaterThan(20000);
    expect(mine).toBeLessThanOrEqual(14);
  });

  it('respect the MP left for converging attacks', () => {
    const state = scenario({ mp: 1, knights: { a: { 0: 2 }, c: { 0: 2 }, b: { 1: 3 } } });
    expect(fields(candidates(state))).toEqual([]);
  });
});
