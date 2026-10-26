import { describe, expect, it } from 'vitest';
import {
  apply,
  initialState,
  isTerminal,
  legalActions,
  replay,
  score,
  validateAction,
  viewFor,
  type Action,
  type CastleState,
  type GameState,
} from '../src';
import { FILLER_CASTLES, scenario, testBoardData } from './fixtures';

/**
 * Two neutral castles left (hall 2, tower 3). `keep` and the 15 one-sword
 * castles are spread over the three players.
 */
function nearlyOver(extra: { knights?: Record<string, Record<number, number>> } = {}) {
  const castles: Record<string, Partial<CastleState>> = { keep: { owner: 0 } };
  const knights: Record<string, Record<number, number>> = { keep: { 0: 1 }, ...extra.knights };
  FILLER_CASTLES.forEach((id, i) => {
    castles[id] = { owner: i % 3 };
    knights[id] = { [i % 3]: 1 };
  });
  return scenario({ castles, knights });
}

const attackHall = (count = 1): Action => ({
  type: 'attackCastle',
  player: 0,
  castle: 'hall',
  from: 'd',
  count,
});

describe('end of the game', () => {
  it('ends at once when the next-to-last neutral castle falls', () => {
    const before = nearlyOver({ knights: { d: { 0: 4 } } });
    expect(isTerminal(before)).toBe(false);
    const { state, events } = apply(before, attackHall());
    expect(isTerminal(state)).toBe(true);
    expect(state.phase).toBe('over');
    expect(state.end).toEqual({ player: 0, lastCastle: 'tower' });
    expect(state.pendingShield).toBeNull();
    expect(events.at(-1)).toEqual({
      type: 'gameOver',
      player: 0,
      lastCastle: 'tower',
      points: [1 + 5 + 2 + 3, 5, 5],
      winners: [0],
    });
    expect(legalActions(state, 0)).toEqual([]);
    expect(validateAction(state, { type: 'endTurn', player: 0 })).toMatch(/game is over/);
  });

  it('gives the last neutral castle to the player who ended the game', () => {
    const state = apply(nearlyOver({ knights: { d: { 0: 4 } } }), attackHall()).state;
    expect(state.castles.tower!.owner).toBeNull();
    expect(score(state).points[0]).toBe(1 + 5 + 2 + 3);
  });

  it('does not end on re-conquering an enemy castle', () => {
    const state = nearlyOver({ knights: { z: { 0: 2 } } });
    const enemy = FILLER_CASTLES.find((id) => state.castles[id]!.owner === 1)!;
    const next = apply(state, {
      type: 'attackCastle',
      player: 0,
      castle: enemy,
      from: 'z',
      count: 1,
    }).state;
    expect(next.castles[enemy]!.owner).toBe(0);
    expect(isTerminal(next)).toBe(false);
  });
});

describe('score', () => {
  it('sums the swords of held castles during the game', () => {
    const state = scenario({
      knights: { tower: { 1: 1 }, hall: { 1: 1 }, keep: { 2: 1 } },
      castles: { tower: { owner: 1 }, hall: { owner: 1 }, keep: { owner: 2 } },
    });
    expect(score(state).points).toEqual([0, 5, 1]);
  });

  it('breaks ties by knights on the board, start areas and castles included', () => {
    const state = scenario({
      knights: { keep: { 0: 1 }, c04: { 1: 1 }, s1: { 0: 2, 1: 2 }, a: { 1: 1 } },
      castles: { keep: { owner: 0 }, c04: { owner: 1 } },
    });
    expect(score(state)).toEqual({ points: [1, 1, 0], knights: [3, 4, 0], winners: [1] });
  });

  it('shares the win on a full tie', () => {
    const state = scenario({
      knights: { keep: { 0: 2 }, c04: { 1: 2 } },
      castles: { keep: { owner: 0 }, c04: { owner: 1 } },
    });
    expect(score(state).winners).toEqual([0, 1]);
  });
});

describe('viewFor', () => {
  const state = scenario({
    knights: { keep: { 0: 1 }, hall: { 1: 1 }, tower: { 2: 1 } },
    castles: {
      keep: { owner: 0, shield: { value: 2, revealed: false } },
      hall: { owner: 1, shield: { value: 3, revealed: true } },
      tower: { owner: 2 },
    },
  });

  it('drops the RNG state', () => {
    expect(viewFor(state, 0)).not.toHaveProperty('rng');
  });

  it('shows own shields and revealed ones only', () => {
    expect(viewFor(state, 0).castles.keep!.shield).toEqual({ value: 2, revealed: false });
    expect(viewFor(state, 1).castles.keep!.shield).toEqual({ value: null, revealed: false });
    expect(viewFor(state, 1).castles.hall!.shield).toEqual({ value: 3, revealed: true });
    expect(viewFor(state, 0).castles.tower!.shield).toBeNull();
  });

  it('shows the viewer their own pool and only counts for others', () => {
    const view = viewFor(state, 0);
    expect(view.ownShields).toEqual([0, 0, 0, 1, 3]);
    expect(view.shieldsLeft).toEqual([5, 5, 6]);
    expect(viewFor(state, null).ownShields).toBeNull();
    expect(JSON.stringify(viewFor(state, 1))).not.toContain('"rng"');
  });

  it('is a copy', () => {
    const view = viewFor(state, 0);
    view.knights.keep![0] = 99;
    expect(state.knights.keep).toEqual([1, 0, 0]);
  });
});

describe('replay', () => {
  it('rebuilds the same state from the seed and the action log', () => {
    const config = { players: 3, board: testBoardData() };
    let state: GameState = initialState(config, 99);
    const log: Action[] = [];
    for (let i = 0; i < 60 && !isTerminal(state); i++) {
      const actions = legalActions(state, state.current);
      const action = actions[(i * 7) % actions.length]!;
      log.push(action);
      state = apply(state, action).state;
    }
    expect(replay(config, 99, log)).toEqual(state);
    expect(replay(JSON.parse(JSON.stringify(config)), 99, JSON.parse(JSON.stringify(log)))).toEqual(
      state,
    );
  });

  it('continues identically from a JSON round trip', () => {
    const config = { players: 4, board: testBoardData() };
    const state = apply(initialState(config, 5), { type: 'roll', player: 0 }).state;
    const copy = JSON.parse(JSON.stringify(state)) as GameState;
    expect(legalActions(copy, 0)).toEqual(legalActions(state, 0));
    const action = legalActions(state, 0)[0]!;
    expect(apply(copy, action)).toEqual(apply(state, action));
  });
});
