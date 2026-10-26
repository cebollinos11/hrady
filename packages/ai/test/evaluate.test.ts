import type { GameState } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { scenario, type Scenario } from '../../engine/test/fixtures';
import { DEFAULT_WEIGHTS, evaluate, playerValues, type Perspective, type Weights } from '../src';

const persp = (weights: Partial<Weights> = {}): Perspective => ({
  player: 0,
  shields: [1, 1, 1],
  weights: { ...DEFAULT_WEIGHTS, ...weights },
});

const value = (spec: Scenario, weights?: Partial<Weights>, player = 0) =>
  playerValues(scenario(spec), persp(weights))[player]!;

describe('evaluation', () => {
  it('values castles by their swords', () => {
    const neutral = value({ knights: { d: { 0: 1 }, a: { 0: 1 } } });
    const hall = value({
      knights: { hall: { 0: 1 }, a: { 0: 1 } },
      castles: { hall: { owner: 0 } },
    });
    const tower = value({
      knights: { tower: { 0: 1 }, a: { 0: 1 } },
      castles: { tower: { owner: 0 } },
    });
    expect(hall).toBeGreaterThan(neutral);
    expect(tower).toBeGreaterThan(hall);
  });

  it('counts a castle an enemy can take next turn as partly lost', () => {
    const keep = { keep: { owner: 0 } };
    const weights = { potential: 0 };
    // Player 1 is two steps from the keep's entrance c with 4 knights: enough against 1.
    const threatened = value({ knights: { keep: { 0: 1 }, a: { 1: 4 } }, castles: keep }, weights);
    const safe = value({ knights: { keep: { 0: 1 }, z: { 1: 4 } }, castles: keep }, weights);
    const garrisoned = value({ knights: { keep: { 0: 3 }, a: { 1: 4 } }, castles: keep }, weights);
    expect(threatened).toBeLessThan(safe);
    expect(garrisoned - 2).toBeCloseTo(safe);
  });

  it('a face-down shield deters by its owner’s known value, or by the expectation', () => {
    const castles = { keep: { owner: 0, shield: { value: 3, revealed: false } } };
    const knights = { keep: { 0: 1 }, a: { 1: 4 } };
    const weights = { potential: 0 };
    const shielded = value({ knights, castles }, weights);
    const bare = value({ knights, castles: { keep: { owner: 0 } } }, weights);
    expect(shielded).toBeGreaterThan(bare);
  });

  it('counts a stack an enemy can beat next turn as partly lost', () => {
    const weights = { potential: 0, castleRisk: 0 };
    const exposed = value({ knights: { b: { 0: 2 }, d: { 1: 3 } } }, weights);
    const safe = value({ knights: { b: { 0: 2 }, z: { 1: 3 } } }, weights);
    const strong = value({ knights: { b: { 0: 3 }, d: { 1: 3 } } }, weights);
    expect(exposed).toBeLessThan(safe);
    expect(strong - 1).toBeCloseTo(safe);
  });

  it('rewards gathering knights close to a castle they can take', () => {
    const spread = value({ knights: { a: { 0: 3 }, e: { 0: 3 } } });
    const merged = value({ knights: { b: { 0: 6 } } });
    const ready = value({ knights: { d: { 0: 6 } } });
    expect(merged).toBeGreaterThan(spread);
    expect(ready).toBeGreaterThan(merged);
  });

  it('rewards blocking the entrance an enemy needs', () => {
    // Player 1's 4 knights on c are ready for the hall (2 swords) from d.
    const blocking = value({ knights: { c: { 1: 4 }, d: { 0: 4 } } }, {}, 1);
    const away = value({ knights: { c: { 1: 4 }, a: { 0: 4 } } }, {}, 1);
    expect(blocking).toBeLessThan(away);
  });

  it('compares the player with the opponents', () => {
    const state: GameState = scenario({ knights: { a: { 0: 3 }, c: { 1: 1 }, h: { 2: 2 } } });
    const values = playerValues(state, persp());
    const others = [values[1]!, values[2]!];
    const { leader } = DEFAULT_WEIGHTS;
    const expected =
      values[0]! - (((1 - leader) * (others[0]! + others[1]!)) / 2 + leader * Math.max(...others));
    expect(evaluate(state, persp())).toBeCloseTo(expected);
  });

  it('scores a finished game by the result', () => {
    const state = scenario({ knights: { tower: { 0: 1 } }, castles: { tower: { owner: 0 } } });
    const over: GameState = { ...state, phase: 'over', end: { player: 0, lastCastle: 'hall' } };
    expect(evaluate(over, persp())).toBeGreaterThan(900);
    expect(evaluate(over, { ...persp(), player: 1 })).toBeLessThan(-900);
  });
});
