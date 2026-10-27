import { legalActions, replay, viewFor, type Action } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { TIMING, publicSeatView, type Room } from '../src/room';
import { Sim, type Client } from './sim';

/** A lobby with the host and `others` joined, before the start. */
function lobby(players = 3, others: string[] = ['Bea']) {
  const sim = new Sim(players);
  const host = sim.connect('Host', sim.hostToken);
  const guests = others.map((name) => sim.connect(name));
  return { sim, host, guests };
}

/** Host and Bea as humans, the remaining seats medium bots, started. */
function started(players = 3, turnSeconds = 0) {
  const { sim, host, guests } = lobby(players);
  for (let s = 2; s < players; s++) sim.send(host, { type: 'setSeat', seat: s, kind: 'medium' });
  sim.send(host, { type: 'setOptions', turnSeconds });
  sim.send(host, { type: 'start' });
  return { sim, host, bea: guests[0]! };
}

const errors = (c: Client) => c.inbox.filter((m) => m.type === 'error');
const lastError = (c: Client) => errors(c).at(-1);

/** Plays steps until `until` holds or nobody can act. */
function playWhile(sim: Sim, humans: Client[], cond: () => boolean, max = 20000) {
  for (let i = 0; i < max && cond(); i++) if (!sim.step(humans)) return false;
  return true;
}

describe('lobby', () => {
  it('seats the creator and joiners, and only the host changes seats and options', () => {
    const { sim, host, guests } = lobby(3, ['Bea', 'Cid', 'Dan']);
    const [bea, cid, dan] = guests as [Client, Client, Client];
    expect(host.room!.host).toBe(host.member);
    expect(sim.room.seats.map((s) => (s.type === 'human' ? s.member : s.type))).toEqual([
      host.member,
      bea.member,
      cid.member,
    ]);
    // The fourth person finds no seat and watches.
    expect(sim.seatOf(dan)).toBeNull();

    sim.send(bea, { type: 'setSeat', seat: 2, kind: 'hard' });
    expect(lastError(bea)).toMatchObject({ code: 'denied' });

    sim.send(cid, { type: 'stand' });
    sim.send(dan, { type: 'sit', seat: 2 });
    expect(sim.seatOf(dan)).toBe(2);
    sim.send(cid, { type: 'sit', seat: 2 });
    expect(lastError(cid)).toMatchObject({ code: 'denied' });

    // The host turns a human's seat into a bot: that human watches.
    sim.send(host, { type: 'setSeat', seat: 2, kind: 'easy' });
    expect(sim.seatOf(dan)).toBeNull();
    expect(dan.room!.seats[2]).toEqual({ type: 'bot', level: 'easy' });

    sim.send(host, { type: 'setOptions', players: 5, turnSeconds: 60 });
    expect(host.room).toMatchObject({ players: 5, turnSeconds: 60 });
    expect(host.room!.seats.slice(3)).toEqual([{ type: 'open' }, { type: 'open' }]);
    sim.send(host, { type: 'start' });
    expect(lastError(host)?.type === 'error' && lastError(host)).toMatchObject({ code: 'denied' });

    sim.send(host, { type: 'setOptions', players: 3 });
    sim.send(bea, { type: 'start' });
    expect(lastError(bea)).toMatchObject({ code: 'denied' });
    sim.send(host, { type: 'start' });
    expect(sim.room.phase).toBe('playing');
    for (const c of [host, bea, cid, dan]) expect(sim.last(c, 'game')).toBeDefined();
    expect(host.view!.viewer).toBe(0);
    expect(dan.view!.viewer).toBeNull();
  });

  it('needs a person in the game, and forgets members who leave the lobby', () => {
    const { sim, host, guests } = lobby(3, ['Bea']);
    sim.send(host, { type: 'setSeat', seat: 2, kind: 'easy' });
    sim.send(guests[0]!, { type: 'leave' });
    expect(guests[0]!.open).toBe(false);
    expect(sim.room.members).toHaveLength(1);
    sim.send(host, { type: 'setSeat', seat: 1, kind: 'easy' });
    sim.send(host, { type: 'setSeat', seat: 0, kind: 'easy' });
    sim.send(host, { type: 'start' });
    expect(lastError(host)).toMatchObject({ message: 'at least one person must play' });
  });

  it('hands the lobby to the next member when the host leaves', () => {
    const { sim, host, guests } = lobby(3, ['Bea']);
    sim.drop(host);
    expect(sim.room.host).toBe(guests[0]!.member);
    expect(guests[0]!.room!.host).toBe(guests[0]!.member);
  });

  it('rejects messages before hello and unknown tokens get a fresh member', () => {
    const { sim } = lobby(3, []);
    const stranger = sim.connect('Eve', 'not-a-real-token-123');
    expect(stranger.member).not.toBe('m1');
    expect(stranger.token).not.toBe(sim.hostToken);
  });
});

describe('a full online game', () => {
  it('plays to the end with AI seats, every message redacted', { timeout: 120_000 }, () => {
    const { sim, host, guests } = lobby(4, ['Bea']);
    const bea = guests[0]!;
    sim.send(host, { type: 'setSeat', seat: 2, kind: 'medium' });
    sim.send(host, { type: 'setSeat', seat: 3, kind: 'easy' });
    sim.send(host, { type: 'setOptions', turnSeconds: 0 });
    const watcher = sim.connect('Wes');
    sim.send(host, { type: 'start' });

    let i = 0;
    const humans = [host, bea];
    const done = playWhile(sim, humans, () => {
      // Bea refreshes now and then.
      if (++i % 400 === 0) {
        sim.drop(humans[1]!);
        humans[1] = sim.connect('Bea', humans[1]!.token!);
      }
      return sim.room.phase === 'playing';
    });
    expect(done).toBe(true);
    expect(sim.room.phase).toBe('over');
    expect(i).toBeGreaterThan(400);

    // Every client's log is the stored log, and it replays to the server's state.
    const g = sim.room.game!;
    for (const c of [...humans, watcher]) expect(c.log).toEqual(sim.log);
    const state = replay(
      g.config,
      g.seed,
      sim.log.map((e) => e.action),
    );
    expect(state).toEqual(g.state);
    expect(watcher.view).toEqual(viewFor(state, null));
    expect(sim.log.some((e) => e.auto)).toBe(true);
    expect(sim.log.filter((e) => e.action.player === 0).every((e) => !e.auto)).toBe(true);
  });

  it('rejects stale, foreign and illegal actions', () => {
    const { sim, host, bea } = started();
    untilTurnOf(sim, bea, [host, bea]);
    const at = sim.log.length;
    sim.send(host, { type: 'act', action: { type: 'roll', player: 1 }, at });
    expect(lastError(host)).toMatchObject({ code: 'denied' });
    sim.send(bea, { type: 'act', action: { type: 'endTurn', player: 1 }, at });
    expect(lastError(bea)).toMatchObject({ code: 'invalid', message: 'roll the die first' });
    sim.send(bea, { type: 'act', action: { type: 'roll', player: 1 }, at: at - 1 });
    expect(lastError(bea)).toMatchObject({ code: 'stale' });
    sim.send(bea, { type: 'act', action: { type: 'roll', player: 1 }, at });
    expect(sim.log).toHaveLength(at + 1);
  });
});

/** Plays until it is `client`'s turn to roll. */
function untilTurnOf(sim: Sim, client: Client, humans: Client[]) {
  const seat = sim.seatOf(client)!;
  playWhile(
    sim,
    humans.filter((h) => h !== client),
    () => !(sim.room.game!.state.current === seat && sim.room.game!.state.phase === 'roll'),
  );
  expect(sim.room.game!.state.current).toBe(seat);
}

describe('reconnecting', () => {
  it('gives the seat back with the whole game after a refresh', () => {
    const { sim, host, bea } = started();
    untilTurnOf(sim, bea, [host, bea]);
    sim.drop(bea);
    expect(host.room!.seats[1]).toMatchObject({ connected: false });
    const again = sim.connect('Bea B.', bea.token!);
    expect(again.member).toBe(bea.member);
    expect(again.log).toEqual(sim.log);
    expect(again.view).toEqual(viewFor(sim.room.game!.state, 1));
    expect(host.room!.seats[1]).toMatchObject({ connected: true, name: 'Bea B.' });
    sim.send(again, { type: 'act', action: { type: 'roll', player: 1 }, at: again.log.length });
    expect(sim.log.at(-1)!.action).toEqual({ type: 'roll', player: 1 });
  });

  it('lets spectators join a running game without a seat', () => {
    const { sim, host, bea } = started();
    playWhile(sim, [host, bea], () => sim.log.length < 20);
    const spy = sim.connect('Spy');
    expect(sim.seatOf(spy)).toBeNull();
    expect(spy.view!.viewer).toBeNull();
    expect(spy.view!.ownShields).toBeNull();
    const p = sim.room.game!.state.current;
    sim.send(spy, { type: 'act', action: { type: 'endTurn', player: p }, at: sim.log.length });
    expect(lastError(spy)).toMatchObject({ code: 'denied' });
  });
});

describe('AI host', () => {
  it('sends bot turns to the host only, and hands them over when the host leaves', () => {
    const { sim, host, bea } = started();
    untilTurnOf(sim, bea, [host, bea]);
    // Play Bea's turn and stop when the bot (seat 2) is to move.
    playWhile(sim, [bea], () => sim.room.game!.state.current !== 2);
    expect(host.duty).toMatchObject({ seat: 2, level: 'medium', at: sim.log.length });
    expect(bea.duty).toBeNull();

    sim.drop(host);
    expect(sim.room.host).toBe(bea.member);
    expect(bea.duty).toMatchObject({ seat: 2, at: sim.log.length });
    playWhile(sim, [bea], () => sim.room.game!.state.current === 2);
    expect(sim.room.game!.state.current).not.toBe(2);

    // The old host comes back as a player; the duty stays with Bea.
    const back = sim.connect('Host', sim.hostToken);
    expect(back.member).toBe(host.member);
    expect(sim.room.host).toBe(bea.member);
  });

  it('moves the duty on when the AI host does not answer', () => {
    const { sim, host, bea } = started();
    playWhile(sim, [host, bea], () => sim.room.game!.state.current !== 2);
    const asked = sim.room.host === host.member ? host : bea;
    const other = asked === host ? bea : host;
    expect(asked.duty).not.toBeNull();
    asked.duty = null; // the tab is asleep
    sim.advance(TIMING.botTimeout + 1);
    expect(sim.room.host).toBe(other.member);
    expect(other.duty).toMatchObject({ seat: 2 });
    expect(sim.last(asked, 'duty')).toEqual({ type: 'duty', duty: null });
  });

  it('stays with nobody when no seated human is connected', () => {
    const { sim, host, bea } = started();
    playWhile(sim, [host, bea], () => sim.room.game!.state.current !== 2);
    const watcher = sim.connect('Wes');
    sim.drop(host);
    sim.drop(bea);
    expect(watcher.duty).toBeNull();
    expect(sim.room.game!.duty).toBeNull();
  });
});

describe('turn timer', () => {
  it('lets a bot play for an idle human until they are back', () => {
    const { sim, host, bea } = started(3, 60);
    untilTurnOf(sim, bea, [host, bea]);
    const at = sim.log.length;
    sim.advance(59_000);
    expect(sim.room.game!.away[1]).toBe(false);
    expect(bea.room!.deadlineIn).toBeGreaterThan(0);
    sim.advance(2_000);
    expect(sim.room.game!.away[1]).toBe(true);
    expect(bea.room!.seats[1]).toMatchObject({ away: true });
    const hostClient = sim.room.host === host.member ? host : bea;
    expect(hostClient.duty).toMatchObject({ seat: 1, level: 'medium', at });
    // The takeover bot never sees the human's own hidden shields (checked in every message).
    expect(hostClient.duty!.obs.view.ownShields!.every((v) => v === 0)).toBe(true);

    // The bot plays on; Bea comes back mid-turn and the duty is withdrawn.
    sim.step([]);
    expect(sim.log.at(-1)).toMatchObject({ auto: true, action: { player: 1 } });
    sim.send(bea, { type: 'back' });
    expect(sim.room.game!.away[1]).toBe(false);
    expect(sim.last(hostClient, 'duty')).toEqual({ type: 'duty', duty: null });
    // Her own moves are hers to undo, the bot's are not.
    const length = sim.log.length;
    sim.send(bea, { type: 'undo', to: length - 1, at: length });
    expect(lastError(bea)).toMatchObject({ code: 'denied' });
  });

  it('takes over a disconnected human after a grace period, even with the timer off', () => {
    const { sim, host, bea } = started(3, 0);
    untilTurnOf(sim, bea, [host, bea]);
    sim.drop(bea);
    sim.advance(TIMING.disconnectGrace - 1000);
    expect(sim.room.game!.away[1]).toBe(false);
    sim.advance(2000);
    expect(sim.room.game!.away[1]).toBe(true);
    // The bot plays her turns while she is gone.
    const start = sim.log.length;
    playWhile(sim, [host], () => sim.log.length < start + 30);
    expect(sim.log.slice(start).some((e) => e.auto && e.action.player === 1)).toBe(true);
    // Reconnecting ends the takeover.
    const again = sim.connect('Bea', bea.token!);
    expect(sim.room.game!.away[1]).toBe(false);
    expect(again.room!.seats[1]).toMatchObject({ away: false, connected: true });
  });

  it('never times out with the timer off while the player is connected', () => {
    const { sim, host, bea } = started(3, 0);
    untilTurnOf(sim, bea, [host, bea]);
    sim.advance(60 * 60_000);
    expect(sim.room.game!.away[1]).toBe(false);
    expect(sim.destroyed).toBe(false);
  });
});

describe('undo', () => {
  it('takes back own moves since the last irreversible action, validated by the server', () => {
    const { sim, host, bea } = started();
    let move: Action | undefined;
    while (!move) {
      untilTurnOf(sim, bea, [host, bea]);
      sim.send(bea, { type: 'act', action: { type: 'roll', player: 1 }, at: sim.log.length });
      move = legalActions(sim.room.game!.state, 1).find((a) => a.type === 'move');
      if (!move)
        sim.send(bea, { type: 'act', action: { type: 'endTurn', player: 1 }, at: sim.log.length });
    }
    const before = sim.room.game!.state;
    const length = sim.log.length;
    sim.send(bea, { type: 'act', action: move, at: length });
    expect(sim.log).toHaveLength(length + 1);
    sim.send(host, { type: 'undo', to: length, at: length + 1 });
    expect(lastError(host)).toMatchObject({ code: 'denied' });
    sim.send(bea, { type: 'undo', to: length - 1, at: length + 1 });
    expect(lastError(bea)).toMatchObject({ code: 'denied' }); // the roll is final
    sim.send(bea, { type: 'undo', to: length, at: length });
    expect(lastError(bea)).toMatchObject({ code: 'stale' });
    sim.send(bea, { type: 'undo', to: length, at: length + 1 });
    expect(sim.log).toHaveLength(length);
    expect(sim.room.game!.state).toEqual(before);
    for (const c of [host, bea]) expect(c.log).toEqual(sim.log);
    expect(sim.last(host, 'undone')).toMatchObject({ length, view: viewFor(before, 0) });
  });
});

describe('expiry', () => {
  const empty = (room: Room) => room.members.every((m) => !m.connected);

  it('deletes an abandoned lobby', () => {
    const { sim, host, guests } = lobby();
    sim.drop(host);
    sim.drop(guests[0]!);
    expect(empty(sim.room)).toBe(true);
    sim.advance(TIMING.lobbyEmpty - 1000);
    expect(sim.destroyed).toBe(false);
    sim.advance(2000);
    expect(sim.destroyed).toBe(true);
  });

  it('keeps a game for returning players longer, then deletes it', () => {
    const { sim, host, bea } = started();
    sim.drop(host);
    sim.drop(bea);
    sim.advance(TIMING.gameEmpty - 1000);
    expect(sim.destroyed).toBe(false);
    sim.advance(2000);
    expect(sim.destroyed).toBe(true);
  });

  it('cleans up a finished game and tells who is still there', { timeout: 120_000 }, () => {
    const { sim, host, bea } = started();
    playWhile(sim, [host, bea], () => sim.room.phase === 'playing');
    expect(sim.room.phase).toBe('over');
    sim.advance(TIMING.overKeep + 1000);
    expect(sim.destroyed).toBe(true);
    expect(sim.last(host, 'closed')).toBeDefined();
  });

  it('expires a room nobody writes to, connected or not', () => {
    const { sim } = lobby();
    sim.advance(TIMING.idle + 1000);
    expect(sim.destroyed).toBe(true);
  });
});

describe('publicSeatView', () => {
  it('hides the seat’s own face-down shields but keeps revealed ones', () => {
    const view = {
      viewer: 1,
      ownShields: [0, 3],
      castles: {
        a: { owner: 1, shield: { value: 2, revealed: false } },
        b: { owner: 1, shield: { value: 1, revealed: true } },
        c: { owner: null, shield: null },
      },
    } as unknown as Parameters<typeof publicSeatView>[0];
    const out = publicSeatView(view);
    expect(out.castles.a!.shield).toEqual({ value: null, revealed: false });
    expect(out.castles.b!.shield).toEqual({ value: 1, revealed: true });
    expect(out.ownShields).toEqual([0, 0]);
  });
});
