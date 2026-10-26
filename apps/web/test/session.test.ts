import { IllegalActionError, legalActions, replay, type Action } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { testBoardData } from '../../../packages/engine/test/fixtures';
import {
  act,
  canUndo,
  exportRecord,
  frames,
  importRecord,
  newSession,
  undo,
  undoFloor,
  undoTurn,
  type Session,
} from '../src/shared/session';

const board = testBoardData();

/** A game on the fixture board after rolling and making `moves` first legal moves. */
function rolledThenMoved(moves: number): Session {
  let s = newSession({ players: 3, board }, 7);
  s = act(s, { type: 'roll', player: 0 });
  for (let i = 0; i < moves; i++) {
    const move = legalActions(s.state, 0).find((a) => a.type === 'move');
    if (!move) throw new Error('no move');
    s = act(s, move);
  }
  return s;
}

describe('session', () => {
  it('records actions and their events', () => {
    const s = rolledThenMoved(1);
    expect(s.record.actions.map((a) => a.type)).toEqual(['roll', 'move']);
    expect(s.log[0]!.events[0]).toMatchObject({ type: 'rolled', player: 0 });
    expect(s.log[1]!.events).toEqual([expect.objectContaining({ type: 'moved' })]);
    expect(s.state).toEqual(replay(s.record.config, s.record.seed, s.record.actions));
  });

  it('throws on illegal actions and leaves the session unchanged', () => {
    const s = newSession({ players: 3, board }, 1);
    expect(() => act(s, { type: 'endTurn', player: 0 })).toThrow(IllegalActionError);
    expect(s.record.actions).toEqual([]);
  });

  it('builds one frame per action', () => {
    const s = rolledThenMoved(2);
    const f = frames(s.record);
    expect(f).toHaveLength(4);
    expect(f[0]!.phase).toBe('roll');
    expect(f[3]).toEqual(s.state);
  });
});

describe('undo', () => {
  const roll: Action = { type: 'roll', player: 0 };
  const move: Action = { type: 'move', player: 0, from: 'a', to: 'b', count: 1 };
  const end: Action = { type: 'endTurn', player: 0 };
  const shield: Action = { type: 'placeShield', player: 0, castle: 'keep' };

  it('stops at the last irreversible action', () => {
    expect(undoFloor([])).toBe(0);
    expect(undoFloor([roll])).toBe(1);
    expect(undoFloor([roll, move, move])).toBe(1);
    expect(undoFloor([roll, move, shield, move])).toBe(3);
    expect(undoFloor([roll, move, end])).toBe(3);
  });

  it('takes back moves one at a time, but not the roll', () => {
    const before = rolledThenMoved(0);
    const after = rolledThenMoved(2);
    expect(canUndo(before)).toBe(false);
    expect(undo(before)).toBe(before);
    expect(canUndo(after)).toBe(true);
    const once = undo(after);
    expect(once.record.actions).toHaveLength(2);
    expect(once.log).toHaveLength(2);
    expect(undo(once).state).toEqual(before.state);
    expect(undoTurn(after).state).toEqual(before.state);
    expect(undoTurn(after).log).toEqual(before.log);
  });

  it('cannot undo across the end of a turn', () => {
    let s = rolledThenMoved(1);
    s = act(s, { type: 'endTurn', player: 0 });
    expect(canUndo(s)).toBe(false);
  });
});

describe('export and import', () => {
  it('round-trips a game', () => {
    const s = rolledThenMoved(2);
    const back = importRecord(exportRecord(s));
    expect(back.record).toEqual(s.record);
    expect(back.state).toEqual(s.state);
    expect(back.log).toEqual(s.log);
  });

  it('rejects malformed records', () => {
    expect(() => importRecord('[]')).toThrow(/object/);
    expect(() => importRecord('{"config":{"players":3},"seed":"x","actions":[]}')).toThrow(/seed/);
    expect(() => importRecord('{"config":{"players":3},"seed":1,"actions":{}}')).toThrow(/actions/);
    expect(() => importRecord('{"config":{"players":9},"seed":1,"actions":[]}')).toThrow(/players/);
    expect(() =>
      importRecord('{"config":{"players":3},"seed":1,"actions":[{"type":"endTurn","player":0}]}'),
    ).toThrow(IllegalActionError);
  });
});
