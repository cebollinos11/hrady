import { validateAction, type GameState } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { scenario } from '../../../packages/engine/test/fixtures';
import {
  NONE,
  attackAction,
  click,
  optionsFor,
  setContribution,
  setCount,
  targetsFor,
  type Selection,
} from '../src/debug/selection';

/** Clicks the nodes in turn, returning the last result. */
function clicks(state: GameState, nodes: string[], start: Selection = NONE) {
  const options = optionsFor(state);
  const valid = (a: Parameters<typeof validateAction>[1]) => validateAction(state, a) === null;
  let result = click(start, options, nodes[0]!, valid);
  for (const node of nodes.slice(1)) result = click(result.selection, options, node, valid);
  return result;
}

describe('options', () => {
  it('indexes legal actions by stack', () => {
    const state = scenario({ knights: { a: { 0: 3 }, c: { 1: 1 } } });
    const options = optionsFor(state);
    expect(options.endTurn).toBe(true);
    expect(options.roll).toBe(false);
    expect(options.movable.get('a')).toBe(3);
    const targets = targetsFor(options, 'a');
    expect([...targets.moves].sort()).toEqual(['b', 'e']);
    expect(targets.fields.size).toBe(0);
    expect(targetsFor(options, 'b').moves.size).toBe(0);
  });

  it('keeps one knight back in a castle', () => {
    const state = scenario({ knights: { keep: { 0: 3 } }, castles: { keep: { owner: 0 } } });
    expect(optionsFor(state).movable.get('keep')).toBe(2);
  });

  it('lists castle attacks and field attack sources', () => {
    const state = scenario({ knights: { d: { 0: 6 }, a: { 0: 1 }, f: { 0: 1 }, b: { 1: 1 } } });
    const options = optionsFor(state);
    expect([...targetsFor(options, 'd').castles].sort()).toEqual(['hall', 'tower']);
    // b holds 1 enemy: a or f alone cannot win, together they can.
    expect([...options.fields.get('b')!]).toEqual([
      ['a', 1],
      ['f', 1],
    ]);
    expect(targetsFor(options, 'a').fields.has('b')).toBe(true);
  });

  it('offers only the roll before rolling', () => {
    const state = { ...scenario(), phase: 'roll' as const };
    const options = optionsFor(state);
    expect(options.roll).toBe(true);
    expect(options.endTurn).toBe(false);
    expect(options.movable.size).toBe(0);
  });
});

describe('click', () => {
  const state = scenario({
    knights: { a: { 0: 3 }, f: { 0: 2 }, b: { 1: 2 }, s1: { 0: 1, 1: 1 } },
  });

  it('selects an own stack with all its knights and deselects on a second click', () => {
    expect(clicks(state, ['a']).selection).toEqual({ kind: 'stack', from: 'a', count: 3 });
    expect(clicks(state, ['a', 'a']).selection).toEqual(NONE);
    expect(clicks(state, ['c']).selection).toEqual(NONE);
  });

  it('selects only the own knights on a shared start area', () => {
    expect(clicks(state, ['s1']).selection).toEqual({ kind: 'stack', from: 's1', count: 1 });
  });

  it('moves the chosen count to a legal target', () => {
    const options = optionsFor(state);
    const selection = setCount(click(NONE, options, 'a').selection, options, 2);
    expect(click(selection, options, 'e')).toEqual({
      selection: NONE,
      action: { type: 'move', player: 0, from: 'a', to: 'e', count: 2 },
    });
  });

  it('clamps the count to 1..movable', () => {
    const options = optionsFor(state);
    const selection = click(NONE, options, 'a').selection;
    expect(setCount(selection, options, 0)).toMatchObject({ count: 1 });
    expect(setCount(selection, options, 9)).toMatchObject({ count: 3 });
  });

  it('switches to another own stack', () => {
    expect(clicks(state, ['a', 'f']).selection).toMatchObject({ kind: 'stack', from: 'f' });
  });

  it('starts a field attack with the selected stack as the first contribution', () => {
    expect(clicks(state, ['a', 'b']).selection).toEqual({
      kind: 'attack',
      target: 'b',
      contributions: { a: 3, f: 0 },
    });
  });

  it('builds a converging attack by toggling sources', () => {
    const options = optionsFor(state);
    let selection = click(NONE, options, 'a').selection;
    selection = setCount(selection, options, 1);
    selection = click(selection, options, 'b').selection;
    // 1 attacker does not outnumber 2: clicking the target does nothing yet.
    const valid = (a: Parameters<typeof validateAction>[1]) => validateAction(state, a) === null;
    expect(click(selection, options, 'b', valid).action).toBeUndefined();
    selection = click(selection, options, 'f').selection;
    expect(selection).toMatchObject({ contributions: { a: 1, f: 2 } });
    const result = click(selection, options, 'b', valid);
    expect(result.action).toEqual({
      type: 'attackField',
      player: 0,
      target: 'b',
      contributions: [
        { from: 'a', count: 1 },
        { from: 'f', count: 2 },
      ],
    });
    expect(result.selection).toEqual(NONE);
    // Toggling a source again takes it out.
    expect(click(selection, options, 'f').selection).toMatchObject({ contributions: { f: 0 } });
  });

  it('starts an empty attack when an enemy marker is clicked first', () => {
    expect(clicks(state, ['b']).selection).toEqual({
      kind: 'attack',
      target: 'b',
      contributions: { a: 0, f: 0 },
    });
    expect(attackAction(clicks(state, ['b']).selection, 0)).toBeNull();
  });

  it('clamps contributions and ignores nodes that cannot contribute', () => {
    const options = optionsFor(state);
    const selection = clicks(state, ['b']).selection;
    expect(setContribution(selection, options, 'a', 7)).toMatchObject({ contributions: { a: 3 } });
    expect(setContribution(selection, options, 'a', -1)).toMatchObject({ contributions: { a: 0 } });
    expect(setContribution(selection, options, 'c', 1)).toBe(selection);
  });

  it('attacks a castle with the chosen number moving in', () => {
    const castle = scenario({ knights: { d: { 0: 6 } } });
    const options = optionsFor(castle);
    const selection = setCount(click(NONE, options, 'd').selection, options, 2);
    expect(click(selection, options, 'tower').action).toEqual({
      type: 'attackCastle',
      player: 0,
      castle: 'tower',
      from: 'd',
      count: 2,
    });
  });
});
