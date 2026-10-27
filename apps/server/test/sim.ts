import { createBot, createRandom, removedShields, type Bot } from '@hrady/ai';
import type { GameView } from '@hrady/engine';
import type {
  ClientMessage,
  Duty,
  LogEntry,
  RoomInfo,
  RoomMode,
  ServerMessage,
} from '@hrady/protocol';
import { expect } from 'vitest';
import {
  createRoom,
  disconnect,
  nextAlarm,
  receive,
  tick,
  type Context,
  type Result,
  type Room,
} from '../src/room';

/** What one browser tab knows, rebuilt from the messages it got. */
export interface Client {
  socket: string;
  member: string | null;
  token: string | null;
  inbox: ServerMessage[];
  room: RoomInfo | null;
  view: GameView | null;
  log: LogEntry[];
  duty: Duty | null;
  open: boolean;
}

/**
 * Drives the pure room functions like `GameRoom` does, with fake sockets and
 * a fake clock. Every message is checked for leaks before it is delivered.
 */
export class Sim {
  room: Room;
  /** The stored log. */
  log: LogEntry[] = [];
  now = 1_000_000;
  hostToken: string;
  clients: Client[] = [];
  destroyed = false;
  private random = createRandom(7);
  private bots = new Map<string, Bot>();

  constructor(players = 3, hostName = 'Host', mode: RoomMode = 'live') {
    const { room, token } = createRoom('ROOM1', hostName, players, this.ctx(), mode);
    this.room = room;
    this.hostToken = token;
  }

  ctx(): Context {
    return { now: this.now, random: () => this.random.next(), history: () => this.log };
  }

  /** Opens a socket and says hello. */
  connect(name: string, token?: string): Client {
    const client: Client = {
      socket: `s${this.clients.length + 1}`,
      member: null,
      token: null,
      inbox: [],
      room: null,
      view: null,
      log: [],
      duty: null,
      open: true,
    };
    this.clients.push(client);
    this.send(
      client,
      token === undefined ? { type: 'hello', name } : { type: 'hello', name, token },
    );
    return client;
  }

  send(client: Client, msg: ClientMessage) {
    expect(client.open, `${client.socket} is closed`).toBe(true);
    this.commit(receive(this.room, client.member, msg, this.ctx()), client);
  }

  /** Closes a socket, like a refresh or a lost connection. */
  drop(client: Client) {
    client.open = false;
    const others = this.clients.some((c) => c.open && c.member === client.member);
    if (client.member && !others) this.commit(disconnect(this.room, client.member, this.ctx()));
  }

  /** Moves the clock on, firing alarms that fall due. */
  advance(ms: number) {
    const end = this.now + ms;
    while (!this.destroyed && nextAlarm(this.room) <= end) {
      this.now = Math.max(this.now, nextAlarm(this.room));
      this.commit(tick(this.room, this.ctx()));
    }
    this.now = end;
  }

  commit(result: Result, from?: Client) {
    if (result.member && from) from.member = result.member;
    if (result.truncate !== undefined) this.log.length = result.truncate;
    if (result.append) this.log.push(...result.append);
    this.room = result.room;
    for (const { to, msg } of result.out) {
      const targets =
        to === null ? (from ? [from] : []) : this.clients.filter((c) => c.open && c.member === to);
      for (const c of targets) this.deliver(c, msg);
    }
    for (const id of result.close ?? [])
      for (const c of this.clients) if (c.member === id) c.open = false;
    if (result.destroy) {
      this.destroyed = true;
      for (const c of this.clients) c.open = false;
    }
  }

  private deliver(c: Client, msg: ServerMessage) {
    checkRedaction(this, c, msg);
    c.inbox.push(msg);
    switch (msg.type) {
      case 'welcome':
        c.token = msg.you.token;
        c.room = msg.room;
        c.view = msg.game?.view ?? null;
        c.log = msg.game ? [...msg.game.log] : [];
        break;
      case 'room':
        c.room = msg.room;
        break;
      case 'game':
        c.view = msg.game.view;
        c.log = [...msg.game.log];
        break;
      case 'action':
        expect(msg.at, 'actions arrive in order').toBe(c.log.length);
        c.log.push(msg.entry);
        c.view = msg.view;
        break;
      case 'undone':
        c.log.length = msg.length;
        c.view = msg.view;
        break;
      case 'duty':
        c.duty = msg.duty;
        break;
    }
  }

  last(c: Client, type: ServerMessage['type']) {
    return c.inbox.filter((m) => m.type === type).at(-1);
  }

  seatOf(c: Client) {
    return this.room.members.find((m) => m.id === c.member)?.seat ?? null;
  }

  private bot(key: string, level: Duty['level'], seed: number) {
    let bot = this.bots.get(key);
    if (!bot) this.bots.set(key, (bot = createBot(level, seed)));
    return bot;
  }

  /**
   * One step of every browser: the AI host plays its duty, and a human whose
   * turn it is plays with a medium bot on its own view. Returns false when
   * nobody could act.
   */
  step(humans: readonly Client[]): boolean {
    for (const c of this.clients) {
      if (!c.open || !c.duty) continue;
      const { seat, level, at, obs } = c.duty;
      c.duty = null;
      const action = this.bot(`duty:${seat}:${level}`, level, 100 + seat).act(obs);
      this.send(c, { type: 'act', action, at });
      return true;
    }
    for (const c of humans) {
      const seat = this.seatOf(c);
      const view = c.view;
      if (!c.open || seat === null || !view || view.phase === 'over' || view.current !== seat)
        continue;
      const info = c.room!.seats[seat]!;
      if (info.type === 'human' && info.away) continue;
      const removed = removedShields(
        c.log.flatMap((e) => e.events),
        view.config.players,
      );
      const action = this.bot(`human:${seat}`, 'medium', 200 + seat).act({ view, removed });
      this.send(c, { type: 'act', action, at: c.log.length });
      return true;
    }
    return false;
  }
}

/**
 * Nothing a client gets may hold the seed, the RNG state or a face-down
 * shield value it is not entitled to: views must be of the recipient's own
 * seat (or a bot seat it plays as AI host), and only the viewer's own hidden
 * shields may carry values, never for a human who is away.
 */
export function checkRedaction(sim: Sim, c: Client, msg: ServerMessage) {
  const text = JSON.stringify(msg);
  expect(text).not.toMatch(/"(seed|rng)"/);
  // Tokens only go to their owner, in the welcome.
  if (msg.type !== 'welcome') expect(text).not.toMatch(/"token"/);
  const room = sim.room;
  const me = room.members.find((m) => m.id === c.member);
  const mySeat = me?.seat ?? null;

  const check = (view: GameView, allowed: number | null, ownValues: boolean) => {
    expect(view.viewer, `${msg.type} view for ${c.socket}`).toBe(allowed);
    expect('rng' in view).toBe(false);
    for (const [id, castle] of Object.entries(view.castles)) {
      const s = castle.shield;
      if (!s || s.revealed || s.value === null) continue;
      expect(castle.owner, `hidden shield on ${id} leaked to ${c.socket}`).toBe(view.viewer);
      expect(ownValues, `own hidden shield on ${id} of an away human`).toBe(true);
    }
    if (view.viewer === null) expect(view.ownShields).toBeNull();
    else if (!ownValues) expect(view.ownShields?.every((v) => v === 0)).toBe(true);
  };

  switch (msg.type) {
    case 'welcome': {
      expect(msg.you.id).toBe(c.member);
      expect(msg.you.token).toBe(me?.token);
      if (msg.game) check(msg.game.view, mySeat, true);
      break;
    }
    case 'game':
    case 'action':
    case 'undone':
      check('game' in msg ? msg.game.view : msg.view, mySeat, true);
      break;
    case 'duty': {
      if (!msg.duty) break;
      expect(room.host, 'duty only goes to the host').toBe(c.member);
      expect(mySeat, 'the AI host is a seated player').not.toBeNull();
      const seat = room.seats[msg.duty.seat]!;
      expect(seat.type === 'bot' || (seat.type === 'human' && room.game!.away[msg.duty.seat])).toBe(
        true,
      );
      check(msg.duty.obs.view, msg.duty.seat, seat.type === 'bot');
      break;
    }
  }
}
