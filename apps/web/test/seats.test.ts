import { apply, viewFor } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { scenario, testBoardData } from '../../../packages/engine/test/fixtures';
import { isBotTurn, observation, seatsFor, viewerFor } from '../src/debug/seats';
import { act, newSession } from '../src/debug/session';

describe('seats', () => {
  it('keep saved choices that fit and make the rest human', () => {
    expect(seatsFor(4, ['hard', 'nonsense', 'easy'])).toEqual(['hard', 'human', 'easy', 'human']);
    expect(seatsFor(3, null)).toEqual(['human', 'human', 'human']);
    expect(seatsFor(3, ['medium', 'medium', 'medium', 'hard'])).toEqual([
      'medium',
      'medium',
      'medium',
    ]);
  });

  it('show the board to the human to move, or to the next human while bots play', () => {
    const state = scenario({ current: 1 });
    expect(viewerFor(state, ['human', 'human', 'human'])).toBe(1);
    expect(viewerFor(state, ['human', 'hard', 'easy'])).toBe(0);
    expect(viewerFor(state, ['human', 'hard', 'human'])).toBe(2);
    expect(viewerFor(state, ['easy', 'medium', 'hard'])).toBeNull();
    expect(isBotTurn(state, ['human', 'hard', 'human'])).toBe(true);
    expect(isBotTurn(state, ['hard', 'human', 'hard'])).toBe(false);
    expect(viewerFor({ ...state, phase: 'over' }, ['human', 'human', 'human'])).toBeNull();
    expect(isBotTurn({ ...state, phase: 'over' }, ['hard', 'hard', 'hard'])).toBe(false);
  });

  it('give a bot its own view and the shields removed so far', () => {
    let session = newSession({ players: 3, board: testBoardData() }, 3);
    session = act(session, { type: 'roll', player: 0 });
    const obs = observation(session, 0);
    expect(obs.view).toEqual(viewFor(session.state, 0));
    expect(obs.removed).toEqual([[], [], []]);
    expect('rng' in obs.view).toBe(false);
    // A castle taken with its shield: the shield is public and gone.
    const state = scenario({
      knights: { c: { 0: 6 }, keep: { 1: 1 } },
      castles: { keep: { owner: 1, shield: { value: 2, revealed: false } } },
    });
    const { state: after, events } = apply(state, {
      type: 'attackCastle',
      player: 0,
      castle: 'keep',
      from: 'c',
      count: 1,
    });
    const taken = {
      ...session,
      state: after,
      log: [{ action: { type: 'endTurn' as const, player: 0 }, events }],
    };
    expect(observation(taken, 0).removed).toEqual([[], [2], []]);
  });
});
