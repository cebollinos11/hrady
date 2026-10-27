import { createBot, removedShields } from '@hrady/ai';
import {
  apply,
  initialState,
  legalActions,
  score,
  viewFor,
  type GameEvent,
  type GameState,
} from '@hrady/engine';
import type { LogEntry, RoomInfo } from '@hrady/protocol';
import { describe, expect, it } from 'vitest';
import { serverUrl, socketUrl } from '../src/online/config';
import { mirror, onlineFloor, stateFromView } from '../src/online/mirror';
import {
  clockText,
  describeGame,
  onlineLabels,
  seatName,
  seatOf,
  startProblem,
} from '../src/online/room';
import { forgetToken, loadOnline, rememberToken, saveOnline } from '../src/online/store';

/** States of a medium-bot game on the Hrady board, every few actions. */
function positions(): GameState[] {
  let state = initialState({ players: 4 }, 11);
  const events: GameEvent[] = [];
  const bots = [0, 1, 2, 3].map((p) => createBot('medium', p));
  const out: GameState[] = [];
  for (let i = 0; i < 900 && state.phase !== 'over'; i++) {
    const p = state.current;
    const action = bots[p]!.act({ view: viewFor(state, p), removed: removedShields(events, 4) });
    const result = apply(state, action);
    events.push(...result.events);
    state = result.state;
    if (i % 25 === 0) out.push(state);
  }
  return out;
}

describe('stateFromView', () => {
  const states = positions();

  it('has face-down shields of several players in the sample', () => {
    const hidden = (s: GameState) =>
      new Set(
        Object.values(s.castles)
          .filter((c) => c.shield && !c.shield.revealed)
          .map((c) => c.owner),
      );
    expect(states.some((s) => hidden(s).size >= 2)).toBe(true);
  });

  it('gives back the same view, legal actions and score for every viewer', () => {
    for (const state of states)
      for (const viewer of [null, 0, 1, 2, 3]) {
        const view = viewFor(state, viewer);
        const pseudo = stateFromView(view);
        expect(viewFor(pseudo, viewer)).toEqual(view);
        expect(legalActions(pseudo, state.current)).toEqual(legalActions(state, state.current));
        expect(score(pseudo)).toEqual(score(state));
      }
  });

  it('holds no hidden value the view did not have', () => {
    for (const state of states) {
      const pseudo = stateFromView(viewFor(state, 1));
      for (const [id, c] of Object.entries(pseudo.castles))
        if (c.shield && !c.shield.revealed && c.owner !== 1) expect(c.shield.value, id).toBe(0);
      pseudo.shields.forEach((s, p) => p !== 1 && expect(s.every((v) => v === 0)).toBe(true));
      expect(pseudo.rng).toBe(0);
    }
  });
});

describe('mirror and undo floor', () => {
  const roll: LogEntry = { action: { type: 'roll', player: 0 }, events: [] };
  const move: LogEntry = {
    action: { type: 'move', player: 0, from: 'a', to: 'b', count: 1 },
    events: [],
  };

  it('can take back own moves since the last irreversible or bot action', () => {
    expect(onlineFloor([])).toBe(0);
    expect(onlineFloor([roll, move, move])).toBe(1);
    expect(onlineFloor([roll, { ...move, auto: true }, move])).toBe(2);
    expect(onlineFloor([roll, move, roll])).toBe(3);
  });

  it('builds a session from a snapshot', () => {
    const state = initialState({ players: 3 }, 5);
    const view = viewFor(state, 2);
    const session = mirror(view, [roll]);
    expect(session.record.actions).toEqual([roll.action]);
    expect(session.log).toEqual([{ action: roll.action, events: [] }]);
    expect(session.record.config).toEqual({ players: 3, firstPlayer: 0 });
    expect(viewFor(session.state, 2)).toEqual(view);
  });
});

describe('room helpers', () => {
  const room: RoomInfo = {
    code: 'ABCDE',
    mode: 'live',
    phase: 'lobby',
    players: 3,
    turnSeconds: 60,
    host: 'm1',
    seats: [
      { type: 'human', member: 'm1', name: 'Ann', connected: true, away: false },
      { type: 'human', member: 'm2', name: 'Bea', connected: false, away: true },
      { type: 'open' },
    ],
    members: [
      { id: 'm1', name: 'Ann', seat: 0, connected: true },
      { id: 'm2', name: 'Bea', seat: 1, connected: false },
      { id: 'm3', name: 'Cid', seat: null, connected: true },
    ],
    turn: null,
    deadlineIn: null,
  };

  it('names seats and labels them for the HUD', () => {
    expect(seatName(room.seats[0], 'm1')).toBe('Ann (you)');
    expect(seatName({ type: 'bot', level: 'hard' }, 'm1')).toBe('Hard bot');
    expect(seatName(room.seats[2], null)).toBe('Open');
    expect(onlineLabels(room, 'm1').slice(0, 2)).toEqual([
      { short: 'you', long: null },
      { short: 'Bea · bot plays', long: 'Bea (bot plays)' },
    ]);
    expect(onlineLabels(room, 'm2')[1]).toEqual({
      short: 'you · bot plays',
      long: 'a bot plays for you',
    });
    expect(seatOf(room, 'm2')).toBe(1);
    expect(seatOf(room, 'm3')).toBeNull();
    expect(seatOf(null, 'm1')).toBeNull();
  });

  it('says why a game cannot start', () => {
    expect(startProblem(room)).toMatch(/open seats/);
    const bots = {
      ...room,
      seats: room.seats.map(() => ({ type: 'bot' as const, level: 'easy' as const })),
    };
    expect(startProblem(bots)).toMatch(/one person/);
    expect(
      startProblem({
        ...room,
        seats: [room.seats[0]!, room.seats[1]!, { type: 'bot', level: 'easy' }],
      }),
    ).toBeNull();
  });

  it('applies the seat-order rule to async games only', () => {
    const bot = { type: 'bot' as const, level: 'easy' as const };
    const [ann, bea] = [room.seats[0]!, room.seats[1]!];
    // Host, a bot, then Bea: Bea would wait for the host to open the game.
    const bad = { ...room, seats: [ann, bot, bea] };
    expect(startProblem(bad)).toBeNull();
    expect(startProblem({ ...bad, mode: 'async' })).toMatch(/right before the host/);
    expect(startProblem({ ...bad, mode: 'async', seats: [ann, bea, bot] })).toBeNull();
  });

  it('lists a game by whose turn it is', () => {
    const playing = (turn: number, mode: 'live' | 'async' = 'async'): RoomInfo => ({
      ...room,
      mode,
      phase: 'playing',
      turn,
      seats: [room.seats[0]!, room.seats[1]!, { type: 'bot', level: 'easy' }],
    });
    expect(describeGame({ room: playing(1), me: 'm2' })).toEqual({
      code: 'ABCDE',
      mode: 'async',
      text: 'Your turn',
      mine: true,
    });
    expect(describeGame({ room: playing(1), me: 'm1' })).toMatchObject({
      text: 'Waiting for Bea',
      mine: false,
    });
    expect(describeGame({ room: playing(2), me: 'm1' }).text).toMatch(/open the game/);
    expect(describeGame({ room: playing(2), me: 'm2' }).text).toMatch(/when the host opens/);
    expect(describeGame({ room: playing(0), me: 'm3' }).text).toBe('Watching');
    expect(describeGame({ room: { ...room, mode: 'async' }, me: 'm1' }).text).toMatch(/lobby/);
    expect(
      describeGame({ room: { ...playing(0), phase: 'over', turn: null }, me: 'm1' }).text,
    ).toBe('Finished');
  });

  it('formats the turn clock', () => {
    expect(clockText(65_000)).toBe('1:05');
    expect(clockText(400)).toBe('0:01');
    expect(clockText(-5)).toBe('0:00');
  });
});

describe('server URL and tokens', () => {
  it('uses the configured URL, or wrangler dev in development', () => {
    expect(serverUrl({ VITE_SERVER_URL: 'https://h.example.workers.dev/', DEV: false }, 'x')).toBe(
      'https://h.example.workers.dev',
    );
    expect(serverUrl({ DEV: true }, 'localhost')).toBe('http://localhost:8787');
    expect(serverUrl({ VITE_SERVER_URL: ' ', DEV: false }, 'x')).toBeNull();
    expect(socketUrl('https://h.example', 'ABCDE')).toBe('wss://h.example/ws/ABCDE');
    expect(socketUrl('http://localhost:8787', 'ABCDE')).toBe('ws://localhost:8787/ws/ABCDE');
  });

  it('keeps a name and a token per room in storage', () => {
    const map = new Map<string, string>();
    const store = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    expect(loadOnline(store)).toEqual({ name: '', tokens: {} });
    let data = rememberToken({ name: 'Ann', tokens: {} }, 'ABCDE', 'tok1');
    data = rememberToken(data, 'FGHJK', 'tok2');
    saveOnline(store, data);
    expect(loadOnline(store)).toEqual({ name: 'Ann', tokens: { ABCDE: 'tok1', FGHJK: 'tok2' } });
    expect(forgetToken(data, 'ABCDE').tokens).toEqual({ FGHJK: 'tok2' });
    for (let i = 0; i < 30; i++) data = rememberToken(data, `R${i}XXX`, `t${i}`);
    saveOnline(store, data);
    const kept = loadOnline(store).tokens;
    expect(Object.keys(kept)).toHaveLength(20);
    expect(kept.R29XXX).toBe('t29');
    map.set('hrady-online', '{bad json');
    expect(loadOnline(store)).toEqual({ name: '', tokens: {} });
  });
});
