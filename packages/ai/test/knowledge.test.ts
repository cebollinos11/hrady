import { legalActions, validateAction, viewFor, type GameEvent } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { scenario } from '../../engine/test/fixtures';
import {
  DEFAULT_WEIGHTS,
  createRandom,
  determinize,
  evaluate,
  expectedShields,
  hiddenShieldPool,
  perspective,
  removedShields,
  shieldDistribution,
  type Observation,
} from '../src';

/**
 * Player 1 holds the keep with a face-down shield, player 2 the tower with a
 * revealed one; player 0 (to move) holds the hall with a face-down shield.
 */
function hidden(keepShield: number, seed = 1) {
  return scenario({
    seed,
    knights: { keep: { 1: 1 }, tower: { 2: 2 }, hall: { 0: 1 }, c: { 0: 4 }, d: { 1: 2 } },
    castles: {
      keep: { owner: 1, shield: { value: keepShield, revealed: false } },
      tower: { owner: 2, shield: { value: 1, revealed: true } },
      hall: { owner: 0, shield: { value: 2, revealed: false } },
    },
  });
}

const observe = (state: ReturnType<typeof hidden>, removed?: number[][]): Observation => ({
  view: viewFor(state, state.current),
  ...(removed && { removed }),
});

describe('removedShields', () => {
  it('collects the shields of castles taken from a player', () => {
    const events: GameEvent[] = [
      {
        type: 'castleAttacked',
        player: 0,
        castle: 'keep',
        from: 'c',
        attackers: 6,
        defender: 1,
        garrison: 1,
        shield: 2,
        won: true,
      },
      {
        type: 'castleAttacked',
        player: 0,
        castle: 'hall',
        from: 'd',
        attackers: 4,
        defender: 2,
        garrison: 1,
        shield: 3,
        won: false,
      },
      {
        type: 'castleAttacked',
        player: 2,
        castle: 'tower',
        from: 'd',
        attackers: 6,
        defender: null,
        garrison: 3,
        shield: null,
        won: true,
      },
      {
        type: 'castleAttacked',
        player: 2,
        castle: 'keep',
        from: 'g',
        attackers: 2,
        defender: 0,
        garrison: 1,
        shield: null,
        won: true,
      },
    ];
    expect(removedShields(events, 3)).toEqual([[], [2], []]);
  });
});

describe('hidden shields', () => {
  it('knows its own shields exactly', () => {
    const obs = observe(hidden(3));
    expect(hiddenShieldPool(obs, 0).sort()).toEqual([0, 0, 0, 1, 2, 3]);
    expect(obs.view.ownShields!.sort()).toEqual([0, 0, 0, 1, 3]);
  });

  it('counts out what is face up or known to be removed', () => {
    const state = hidden(3);
    expect(hiddenShieldPool(observe(state), 2).sort()).toEqual([0, 0, 0, 2, 3]);
    expect(hiddenShieldPool(observe(state, [[], [3], []]), 1).sort()).toEqual([0, 0, 0, 1, 2]);
    // Public knowledge does not include the viewer's own face-down shield.
    expect(hiddenShieldPool(observe(state), 0, true).sort()).toEqual([0, 0, 0, 1, 2, 3]);
  });

  it('expects the mean of what is left', () => {
    const obs = observe(hidden(3));
    expect(expectedShields(obs)[1]).toBeCloseTo(1);
    expect(expectedShields(obs)[2]).toBeCloseTo(1);
    const odds = shieldDistribution(obs, 2);
    expect(odds.get(0)).toBeCloseTo(3 / 5);
    expect(odds.get(1)).toBeUndefined();
  });
});

describe('determinize', () => {
  it('does not depend on information the viewer lacks', () => {
    // Same view; the hidden keep shield, the others' unplaced shields and the RNG differ.
    const a = hidden(0, 1);
    const b = hidden(3, 99);
    b.shields[2] = [...b.shields[2]!].reverse();
    expect(viewFor(a, 0)).toEqual(viewFor(b, 0));
    for (let seed = 1; seed <= 20; seed++)
      expect(determinize(observe(a), createRandom(seed))).toEqual(
        determinize(observe(b), createRandom(seed)),
      );
  });

  it('keeps everything the viewer sees and samples the rest from what is possible', () => {
    const state = hidden(3);
    const obs = observe(state);
    const counts = new Map<number, number>();
    for (let seed = 1; seed <= 600; seed++) {
      const world = determinize(obs, createRandom(seed));
      expect(world.knights).toEqual(state.knights);
      expect(world.castles.hall).toEqual(state.castles.hall);
      expect(world.castles.tower).toEqual(state.castles.tower);
      expect(world.shields[0]).toEqual(state.shields[0]);
      expect(world.shields.map((s) => s.length)).toEqual(state.shields.map((s) => s.length));
      const keep = world.castles.keep!.shield!;
      expect(keep.revealed).toBe(false);
      // Player 1's hidden shields (keep + 5 unplaced) are a shuffle of all six.
      expect([keep.value, ...world.shields[1]!].sort()).toEqual([0, 0, 0, 1, 2, 3]);
      counts.set(keep.value, (counts.get(keep.value) ?? 0) + 1);
      // Legality never depends on the sampled values.
      for (const action of legalActions(state, 0)) expect(validateAction(world, action)).toBeNull();
    }
    expect(counts.get(0)! / 600).toBeCloseTo(0.5, 1);
    expect(counts.get(3)! / 600).toBeCloseTo(1 / 6, 1);
  });

  it('rejects a spectator view', () => {
    expect(() => determinize({ view: viewFor(hidden(1), null) }, createRandom(1))).toThrow();
  });
});

describe('evaluation and hidden information', () => {
  it('reads other players’ face-down shields only through the expectation', () => {
    const obs = observe(hidden(0));
    const persp = perspective(obs);
    const low = hidden(0);
    const high = hidden(3);
    expect(evaluate(low, persp)).toBe(evaluate(high, persp));
    // Its own face-down shield does count.
    const weaker = hidden(0);
    weaker.castles.hall = { owner: 0, shield: { value: 0, revealed: false } };
    expect(evaluate(weaker, persp)).not.toBe(evaluate(low, persp));
  });

  it('stays the same through a determinized state', () => {
    const obs = observe(hidden(2));
    const persp = { ...perspective(obs), weights: DEFAULT_WEIGHTS };
    const values = new Set<number>();
    for (let seed = 1; seed <= 10; seed++)
      values.add(evaluate(determinize(obs, createRandom(seed)), persp));
    expect(values.size).toBe(1);
  });
});
