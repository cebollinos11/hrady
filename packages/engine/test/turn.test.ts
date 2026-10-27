import { describe, expect, it } from 'vitest';
import { loadHradyBoard } from '@hrady/board';
import {
  IllegalActionError,
  apply,
  initialState,
  boardContext,
  legalActions,
  validateAction,
  type Action,
  type GameState,
} from '../src';
import { rigRoll, scenario, testBoardData } from './fixtures';

const board = testBoardData();
const move = (from: string, to: string, count: number, player = 0): Action => ({
  type: 'move',
  player,
  from,
  to,
  count,
});
const run = (state: GameState, ...actions: Action[]) =>
  actions.reduce((s, a) => apply(s, a).state, state);

describe('setup', () => {
  it('accepts 3–5 players only', () => {
    for (const players of [3, 4, 5]) expect(() => initialState({ players }, 1)).not.toThrow();
    for (const players of [2, 6, 3.5])
      expect(() => initialState({ players }, 1)).toThrow(RangeError);
  });

  it('starts with neutral castles, an empty board and six shields each', () => {
    const state = initialState({ players: 4 }, 7);
    expect(Object.keys(state.castles)).toHaveLength(18);
    expect(Object.values(state.castles).every((c) => c.owner === null && !c.shield)).toBe(true);
    expect(state.knights).toEqual({});
    expect(state.shields).toEqual(Array.from({ length: 4 }, () => [0, 0, 0, 1, 2, 3]));
    expect(state).toMatchObject({ phase: 'roll', current: 0, turn: 1, mp: 0, roll: null });
  });

  it('lets the config pick the first player', () => {
    expect(initialState({ players: 3, firstPlayer: 2 }, 1).current).toBe(2);
    expect(() => initialState({ players: 3, firstPlayer: 3 }, 1)).toThrow(RangeError);
  });

  it('is plain JSON and deterministic for a seed', () => {
    const state = initialState({ players: 3, board }, 42);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(initialState({ players: 3, board }, 42)).toEqual(state);
  });

  it('plays on the Hrady board by default', () => {
    const state = initialState({ players: 3 }, 3);
    expect(state.config.board).toBeNull();
    const { state: next, events } = apply(rigRoll(state, 4), { type: 'roll', player: 0 });
    const start = loadHradyBoard().startFor(4).id;
    expect(next.knights[start]).toEqual([1, 0, 0]);
    expect(events).toContainEqual({ type: 'knightPlaced', player: 0, start });
  });
});

describe('roll and place', () => {
  const fresh = () => initialState({ players: 3, board }, 1);

  it('offers only the roll at the start of a turn', () => {
    expect(legalActions(fresh(), 0)).toEqual([{ type: 'roll', player: 0 }]);
    expect(legalActions(fresh(), 1)).toEqual([]);
  });

  it('places one knight on the start area of the roll and grants 3 MP', () => {
    const { state, events } = apply(rigRoll(fresh(), 4), { type: 'roll', player: 0 });
    expect(events).toEqual([
      { type: 'rolled', player: 0, value: 4 },
      { type: 'knightPlaced', player: 0, start: 's4' },
    ]);
    expect(state.knights.s4).toEqual([1, 0, 0]);
    expect(state).toMatchObject({ phase: 'move', mp: 3, roll: 4 });
  });

  it('makes the old knight step off first, then spawns the new one', () => {
    const state = fresh();
    state.knights.s2 = [1, 0, 0];
    const { state: next, events } = apply(rigRoll(state, 2), { type: 'roll', player: 0 });
    expect(events[1]).toEqual({ type: 'spawnBlocked', player: 0, start: 's2' });
    expect(next).toMatchObject({ pendingSpawn: 's2', mp: 3 });
    expect(next.knights.s2).toEqual([1, 0, 0]);

    const moves = legalActions(next, 0);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((a) => a.type === 'move' && a.from === 's2' && a.count === 1)).toBe(true);
    expect(validateAction(next, { type: 'endTurn', player: 0 })).toMatch(/must move away/);

    const first = moves[0]! as Extract<Action, { type: 'move' }>;
    const { state: after, events: moved } = apply(next, first);
    expect(moved.map((e) => e.type)).toEqual(['moved', 'knightPlaced']);
    expect(after).toMatchObject({ pendingSpawn: null, mp: 2 });
    expect(after.knights.s2).toEqual([1, 0, 0]);
    expect(after.knights[first.to]).toEqual([1, 0, 0]);
  });

  it('falls back to no spawn and 3 MP when enemies surround the start', () => {
    const state = fresh();
    state.knights.s2 = [1, 0, 0];
    const ctx = boardContext(state.config);
    for (const n of ctx.neighbours('s2')) state.knights[n] = [0, 1, 0];
    const { state: next, events } = apply(rigRoll(state, 2), { type: 'roll', player: 0 });
    expect(events[1]).toEqual({ type: 'placementSkipped', player: 0, start: 's2' });
    expect(next).toMatchObject({ pendingSpawn: null, mp: 3 });
    expect(next.knights.s2).toEqual([1, 0, 0]);
  });

  it('places normally when only other colours are on the start area', () => {
    const state = fresh();
    state.knights.s2 = [0, 3, 1];
    state.knights.s2 = [0, 3, 1];
    expect(apply(rigRoll(state, 2), { type: 'roll', player: 0 }).state.knights.s2).toEqual([
      1, 3, 1,
    ]);
  });

  it('rolls once per turn and only for the current player', () => {
    const state = run(fresh(), { type: 'roll', player: 0 });
    expect(validateAction(state, { type: 'roll', player: 0 })).toMatch(/already rolled/);
    expect(validateAction(fresh(), { type: 'roll', player: 1 })).toMatch(/player 0's turn/);
    expect(validateAction(fresh(), { type: 'endTurn', player: 0 })).toMatch(/roll the die/);
  });

  it('draws die values 1–6 from the seed', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const { events } = apply(initialState({ players: 3, board }, seed), {
        type: 'roll',
        player: 0,
      });
      if (events[0]?.type === 'rolled') seen.add(events[0].value);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('movement', () => {
  it('moves a whole stack one step for 1 MP', () => {
    const { state, events } = apply(scenario({ knights: { a: { 0: 4 } } }), move('a', 'b', 4));
    expect(state.knights).toEqual({ b: [4, 0, 0] });
    expect(state.mp).toBe(2);
    expect(events).toEqual([{ type: 'moved', player: 0, from: 'a', to: 'b', count: 4 }]);
  });

  it('splits stacks and spreads the 3 MP freely', () => {
    const state = run(
      scenario({ knights: { a: { 0: 4 }, e: { 0: 1 } } }),
      move('a', 'b', 1),
      move('a', 'e', 2),
      move('e', 'f', 3),
    );
    expect(state.knights).toEqual({ a: [1, 0, 0], b: [1, 0, 0], f: [3, 0, 0] });
    expect(state.mp).toBe(0);
    expect(validateAction(state, move('a', 'b', 1))).toMatch(/no movement points/);
    expect(legalActions(state, 0)).toEqual([{ type: 'endTurn', player: 0 }]);
  });

  it('lists every split as its own action', () => {
    const moves = legalActions(scenario({ knights: { e: { 0: 2 } } }), 0).filter(
      (a) => a.type === 'move',
    );
    expect(moves).toEqual([
      move('e', 'a', 1),
      move('e', 'a', 2),
      move('e', 'f', 1),
      move('e', 'f', 2),
    ]);
  });

  it('merges into an own stack', () => {
    const state = run(scenario({ knights: { a: { 0: 2 }, b: { 0: 3 } } }), move('a', 'b', 2));
    expect(state.knights).toEqual({ b: [5, 0, 0] });
  });

  it('leaves start areas but never re-enters one', () => {
    const state = run(scenario({ knights: { s1: { 0: 1, 1: 2 } } }), move('s1', 'a', 1));
    expect(state.knights).toEqual({ s1: [0, 2, 0], a: [1, 0, 0] });
    expect(validateAction(state, move('a', 's1', 1))).toMatch(/never re-enter/);
  });

  it('is blocked by enemy knights on a path marker', () => {
    const state = scenario({ knights: { a: { 0: 5 }, b: { 1: 1 } } });
    expect(validateAction(state, move('a', 'b', 5))).toMatch(/held by another player/);
    expect(legalActions(state, 0).some((a) => a.type === 'move' && a.to === 'b')).toBe(false);
  });

  it('may not walk into neutral or enemy castles', () => {
    const state = scenario({
      knights: { c: { 0: 9 }, g: { 1: 1 } },
      castles: { keep: { owner: 2 } },
    });
    state.knights.keep = [0, 0, 1];
    expect(validateAction(state, move('c', 'keep', 1))).toMatch(/not your castle/);
    expect(validateAction(scenario({ knights: { d: { 0: 9 } } }), move('d', 'tower', 1))).toMatch(
      /not your castle/,
    );
  });

  it('lets owners move in and out of their castle and through it', () => {
    let state = scenario({
      knights: { c: { 0: 3 }, keep: { 0: 1 } },
      castles: { keep: { owner: 0 } },
    });
    state = run(state, move('c', 'keep', 3), move('keep', 'g', 3));
    expect(state.knights).toEqual({ keep: [1, 0, 0], g: [3, 0, 0] });
    expect(state.mp).toBe(1);
  });

  it('keeps at least one knight in a held castle', () => {
    const state = scenario({ knights: { keep: { 0: 2 } }, castles: { keep: { owner: 0 } } });
    expect(validateAction(state, move('keep', 'c', 2))).toMatch(/1–1 knights/);
    expect(validateAction(state, move('keep', 'c', 1))).toBeNull();
    const lone = scenario({ knights: { keep: { 0: 1 } }, castles: { keep: { owner: 0 } } });
    expect(validateAction(lone, move('keep', 'c', 1))).toMatch(/no knights to move/);
  });

  it('rejects malformed moves', () => {
    const state = scenario({ knights: { a: { 0: 2 } } });
    expect(validateAction(state, move('a', 'b', 0))).toMatch(/1–2/);
    expect(validateAction(state, move('a', 'b', 3))).toMatch(/1–2/);
    expect(validateAction(state, move('a', 'b', 1.5))).toMatch(/malformed/);
    expect(validateAction(state, move('a', 'c', 1))).toMatch(/not connected/);
    expect(validateAction(state, move('a', 'nowhere', 1))).toMatch(/not connected/);
    expect(validateAction(state, move('b', 'c', 1))).toMatch(/no knights/);
    expect(validateAction(state, move('a', 'b', 1, 1))).toMatch(/player 0's turn/);
    expect(validateAction(state, { type: 'fly', player: 0 } as unknown as Action)).toMatch(
      /unknown action/,
    );
    expect(() => apply(state, move('a', 'c', 1))).toThrow(IllegalActionError);
  });

  it('never modifies the input state', () => {
    const state = scenario({ knights: { a: { 0: 2 } } });
    const before = JSON.stringify(state);
    apply(state, move('a', 'b', 1));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('end of turn', () => {
  it('passes clockwise and resets the turn state', () => {
    const { state, events } = apply(scenario({ current: 2, mp: 2 }), {
      type: 'endTurn',
      player: 2,
    });
    expect(events).toEqual([{ type: 'turnEnded', player: 2, next: 0 }]);
    expect(state).toMatchObject({ current: 0, phase: 'roll', mp: 0, roll: null, turn: 2 });
  });

  it('may end the turn with movement points left', () => {
    expect(legalActions(scenario({ mp: 3 }), 0)).toContainEqual({ type: 'endTurn', player: 0 });
  });
});
