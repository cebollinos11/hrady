import {
  apply,
  validateAction,
  initialState,
  viewFor,
  type Action,
  type GameConfig,
  type GameState,
  type GameView,
  type PlayerId,
} from '@hrady/engine';
import {
  DEFAULT_TURN_SECONDS,
  type BotLevel,
  type BotObservation,
  type ClientMessage,
  type GameSnapshot,
  type LogEntry,
  type RoomInfo,
  type RoomPhase,
  type SeatInfo,
  type ServerMessage,
} from '@hrady/protocol';

/**
 * The room logic as pure functions: each takes the room, an input and a
 * context (time, randomness, the stored log) and returns the new room, the
 * messages to send and the changes to the stored log. `GameRoom` (index.ts)
 * only does the I/O around them.
 */

/** Timings, in milliseconds. */
export const TIMING = {
  /** A disconnected player's turn is played by a bot after this long. */
  disconnectGrace: 30_000,
  /** AI duty moves to another human when the AI host does not answer within this. */
  botTimeout: 45_000,
  /** A room nobody is connected to expires after this long… */
  lobbyEmpty: 10 * 60_000,
  gameEmpty: 30 * 60_000,
  overEmpty: 5 * 60_000,
  /** …a finished game this long after its end… */
  overKeep: 30 * 60_000,
  /** …and any room after this long without a single message. */
  idle: 6 * 60 * 60_000,
};

/** Bot level that plays for a human who is away. */
export const TAKEOVER_LEVEL: BotLevel = 'medium';
/** Members kept per room; disconnected spectators make room for new ones. */
export const MAX_MEMBERS = 32;

export interface Member {
  /** Public id, shown to everyone. */
  id: string;
  /** Secret that gives the member back on reconnect; only ever sent to them. */
  token: string;
  name: string;
  seat: PlayerId | null;
  connected: boolean;
  /** When the member's last socket closed. */
  lastSeen: number;
}

export type Seat =
  { type: 'open' } | { type: 'human'; member: string } | { type: 'bot'; level: BotLevel };

export interface Game {
  config: GameConfig;
  /** Never leaves the server. */
  seed: number;
  /** Number of actions applied; the actions themselves are in the stored log. */
  length: number;
  state: GameState;
  /** State after the last irreversible action, and the moves since: what undo may take back. */
  floor: GameState;
  tail: Action[];
  /** Shield values removed from the game per player (public; given to bots). */
  removed: number[][];
  /** Seats whose human is away: a bot plays for them until they are back. */
  away: boolean[];
  /** When the idle clock of the player to move started: the turn start or their last action. */
  clock: number;
  /** The last duty sent to the AI host. */
  duty: { member: string; seat: PlayerId; at: number; since: number } | null;
  /** When the game ended. */
  ended: number | null;
}

export interface Room {
  code: string;
  created: number;
  /** Time of the last message from anyone. */
  updated: number;
  phase: RoomPhase;
  players: number;
  turnSeconds: number;
  seats: Seat[];
  members: Member[];
  nextMember: number;
  host: string | null;
  game: Game | null;
}

export interface Context {
  now: number;
  /** Uniform in `[0, 1)`; cryptographic in the Durable Object. */
  random: () => number;
  /** The stored log before this call. */
  history: () => readonly LogEntry[];
}

/** A message for every socket of a member, or (`to: null`) for the socket that sent the input. */
export interface Outgoing {
  to: string | null;
  msg: ServerMessage;
}

export interface Result {
  room: Room;
  out: Outgoing[];
  /** The sending socket now belongs to this member (after `hello`). */
  member?: string;
  /** The stored log keeps only its first `truncate` entries (applied before `append`). */
  truncate?: number;
  append?: LogEntry[];
  /** Close every socket of these members. */
  close?: string[];
  /** The room is over: close every socket and delete its storage. */
  destroy?: boolean;
}

function randomToken(random: () => number): string {
  let token = '';
  for (let i = 0; i < 24; i++) token += Math.floor(random() * 36).toString(36);
  return token;
}

/** A new room with its creator in the first seat; the creator is the host. */
export function createRoom(
  code: string,
  name: string,
  players: number,
  ctx: Pick<Context, 'now' | 'random'>,
): { room: Room; token: string } {
  const token = randomToken(ctx.random);
  const host: Member = { id: 'm1', token, name, seat: 0, connected: false, lastSeen: ctx.now };
  const seats: Seat[] = Array.from({ length: players }, (_, i) =>
    i === 0 ? { type: 'human', member: host.id } : { type: 'open' },
  );
  const room: Room = {
    code,
    created: ctx.now,
    updated: ctx.now,
    phase: 'lobby',
    players,
    turnSeconds: DEFAULT_TURN_SECONDS,
    seats,
    members: [host],
    nextMember: 2,
    host: host.id,
    game: null,
  };
  return { room, token };
}

// --- Views -------------------------------------------------------------------

/** When a bot takes over the player to move, or `null` if no timer runs. */
export function deadline(room: Room): number | null {
  const g = room.game;
  if (room.phase !== 'playing' || !g || g.state.phase === 'over') return null;
  const seat = room.seats[g.state.current];
  if (seat?.type !== 'human' || g.away[g.state.current]) return null;
  const m = member(room, seat.member);
  const times: number[] = [];
  if (room.turnSeconds > 0) times.push(g.clock + room.turnSeconds * 1000);
  if (!m?.connected) times.push(Math.max(g.clock, m?.lastSeen ?? 0) + TIMING.disconnectGrace);
  return times.length ? Math.min(...times) : null;
}

export function roomInfo(room: Room, now: number): RoomInfo {
  const seats: SeatInfo[] = room.seats.map((s, i) => {
    if (s.type !== 'human') return s;
    const m = member(room, s.member);
    return {
      type: 'human',
      member: s.member,
      name: m?.name ?? '?',
      connected: m?.connected ?? false,
      away: room.game?.away[i] ?? false,
    };
  });
  const due = deadline(room);
  return {
    code: room.code,
    phase: room.phase,
    players: room.players,
    turnSeconds: room.turnSeconds,
    host: room.host,
    seats,
    members: room.members.map(({ id, name, seat, connected }) => ({ id, name, seat, connected })),
    deadlineIn: due === null ? null : Math.max(0, due - now),
  };
}

/** Compares rooms by what members see (the deadline as a time, not a countdown). */
const infoKey = (room: Room) => JSON.stringify(roomInfo(room, 0));

/** The view of a seat whose human is away: their own face-down shields are hidden too. */
export function publicSeatView(view: GameView): GameView {
  const castles: GameView['castles'] = {};
  for (const [id, c] of Object.entries(view.castles))
    castles[id] = {
      owner: c.owner,
      shield: c.shield && {
        value: c.shield.revealed ? c.shield.value : null,
        revealed: c.shield.revealed,
      },
    };
  return { ...view, castles, ownShields: view.ownShields && view.ownShields.map(() => 0) };
}

/**
 * What the AI host gets to play `seat`: a bot seat's own view, or for a human
 * who is away a view without their hidden shield values (so no human's
 * face-down shields ever reach another player), plus the removed shields.
 */
export function observationFor(room: Room, seat: PlayerId): BotObservation {
  const g = room.game!;
  const view = viewFor(g.state, seat);
  return {
    view: room.seats[seat]?.type === 'bot' ? view : publicSeatView(view),
    removed: g.removed.map((r) => [...r]),
  };
}

function snapshot(room: Room, seat: PlayerId | null, log: readonly LogEntry[]): GameSnapshot {
  return { view: viewFor(room.game!.state, seat), log: [...log] };
}

// --- Helpers -----------------------------------------------------------------

const member = (room: Room, id: string | null) =>
  id === null ? undefined : room.members.find((m) => m.id === id);

function unseat(room: Room, m: Member) {
  if (m.seat !== null) room.seats[m.seat] = { type: 'open' };
  m.seat = null;
}

function seat(room: Room, m: Member, seat: PlayerId) {
  unseat(room, m);
  room.seats[seat] = { type: 'human', member: m.id };
  m.seat = seat;
}

const connected = (room: Room) => room.members.filter((m) => m.connected);

/** Members who may run the lobby and the AI seats: connected, and seated once the game runs. */
function eligibleHosts(room: Room): Member[] {
  const list = connected(room).filter((m) => room.phase === 'lobby' || m.seat !== null);
  return list.sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
}

/** Keeps the host if they are still eligible, otherwise hands over to the first eligible member. */
function syncHost(room: Room) {
  const host = member(room, room.host);
  const eligible = eligibleHosts(room);
  if (host && eligible.includes(host)) return;
  if (eligible[0]) room.host = eligible[0].id;
  else if (!host) room.host = null;
}

/** Who should play the seat to move: its bot level, if a bot plays it now. */
function botLevel(room: Room): BotLevel | null {
  const g = room.game;
  if (room.phase !== 'playing' || !g || g.state.phase === 'over') return null;
  const s = room.seats[g.state.current];
  if (s?.type === 'bot') return s.level;
  if (s?.type === 'human' && g.away[g.state.current]) return TAKEOVER_LEVEL;
  return null;
}

/** Sends the AI host the seat it should play, or cancels a duty that no longer holds. */
function syncDuty(room: Room, out: Outgoing[], now: number) {
  const g = room.game;
  if (!g) return;
  const level = botLevel(room);
  const host = member(room, room.host);
  const want =
    level && host?.connected && host.seat !== null
      ? { member: host.id, seat: g.state.current, at: g.length, level }
      : null;
  const prev = g.duty;
  if (prev && (!want || prev.member !== want.member) && member(room, prev.member)?.connected)
    out.push({ to: prev.member, msg: { type: 'duty', duty: null } });
  if (!want) {
    g.duty = null;
    return;
  }
  if (prev && prev.member === want.member && prev.at === want.at && prev.seat === want.seat) return;
  g.duty = { member: want.member, seat: want.seat, at: want.at, since: now };
  out.push({
    to: want.member,
    msg: {
      type: 'duty',
      duty: {
        seat: want.seat,
        level: want.level,
        at: want.at,
        obs: observationFor(room, want.seat),
      },
    },
  });
}

/** When the room expires. */
export function expiry(room: Room): number {
  let t = room.updated + TIMING.idle;
  if (!room.members.some((m) => m.connected)) {
    const left = Math.max(room.updated, ...room.members.map((m) => m.lastSeen));
    const ttl =
      room.phase === 'lobby'
        ? TIMING.lobbyEmpty
        : room.phase === 'playing'
          ? TIMING.gameEmpty
          : TIMING.overEmpty;
    t = Math.min(t, left + ttl);
  }
  if (room.phase === 'over' && room.game?.ended != null)
    t = Math.min(t, room.game.ended + TIMING.overKeep);
  return t;
}

/** The next time `tick` has something to do. */
export function nextAlarm(room: Room): number {
  const times = [expiry(room)];
  const due = deadline(room);
  if (due !== null) times.push(due);
  if (room.game?.duty) times.push(room.game.duty.since + TIMING.botTimeout);
  return Math.min(...times);
}

/** Wraps up a change: host and AI duty, and a room update for everyone if anything visible changed. */
function finish(
  before: string,
  room: Room,
  out: Outgoing[],
  now: number,
  extra: Partial<Result> = {},
): Result {
  syncHost(room);
  syncDuty(room, out, now);
  if (infoKey(room) !== before) {
    const info = roomInfo(room, now);
    for (const m of connected(room)) out.push({ to: m.id, msg: { type: 'room', room: info } });
  }
  return { room, out, ...extra };
}

const error = (message: string, code?: 'stale' | 'denied' | 'invalid'): Outgoing => ({
  to: null,
  msg: code ? { type: 'error', message, code } : { type: 'error', message },
});

// --- Inputs ------------------------------------------------------------------

/** A message from a socket; `from` is its member, `null` before `hello`. */
export function receive(
  current: Room,
  from: string | null,
  msg: ClientMessage,
  ctx: Context,
): Result {
  const room = structuredClone(current);
  const before = infoKey(current);
  const out: Outgoing[] = [];
  room.updated = ctx.now;

  if (msg.type === 'hello') return hello(before, room, msg, ctx);

  const m = member(room, from);
  if (!m) return { room: current, out: [error('say hello first')] };
  const isHost = room.host === m.id;
  const lobby = room.phase === 'lobby';
  const deny = (message: string) => ({ room: current, out: [error(message, 'denied')] });

  switch (msg.type) {
    case 'sit':
      if (!lobby) return deny('the game has started');
      if (msg.seat >= room.players || room.seats[msg.seat]?.type !== 'open')
        return deny('that seat is taken');
      seat(room, m, msg.seat);
      break;

    case 'stand':
      if (!lobby) return deny('the game has started');
      unseat(room, m);
      break;

    case 'setSeat': {
      if (!lobby || !isHost) return deny('only the host can change seats in the lobby');
      if (msg.seat >= room.players) return deny('no such seat');
      const s = room.seats[msg.seat]!;
      if (s.type === 'human') unseat(room, member(room, s.member)!);
      room.seats[msg.seat] =
        msg.kind === 'open' ? { type: 'open' } : { type: 'bot', level: msg.kind };
      break;
    }

    case 'setOptions':
      if (!lobby || !isHost) return deny('only the host can change the options');
      if (msg.turnSeconds !== undefined) room.turnSeconds = msg.turnSeconds;
      if (msg.players !== undefined) {
        for (const other of room.members)
          if (other.seat !== null && other.seat >= msg.players) unseat(room, other);
        room.seats = Array.from(
          { length: msg.players },
          (_, i): Seat => room.seats[i] ?? { type: 'open' },
        );
        room.players = msg.players;
      }
      break;

    case 'start':
      return start(before, room, m, ctx);

    case 'act':
      return act(before, room, current, m, msg.action, msg.at, ctx);

    case 'undo':
      return undo(before, room, current, m, msg.to, msg.at, ctx);

    case 'back': {
      const g = room.game;
      if (room.phase !== 'playing' || !g || m.seat === null || !g.away[m.seat]) break;
      g.away[m.seat] = false;
      if (g.state.current === m.seat) g.clock = ctx.now;
      break;
    }

    case 'leave':
      // In the lobby and as a spectator the member is forgotten; a seated
      // player in a game only disconnects and can come back with the token.
      if (lobby || m.seat === null) {
        unseat(room, m);
        room.members = room.members.filter((x) => x !== m);
      } else {
        m.connected = false;
        m.lastSeen = ctx.now;
      }
      return finish(before, room, out, ctx.now, { close: [m.id] });
  }
  return finish(before, room, out, ctx.now);
}

function hello(
  before: string,
  room: Room,
  msg: Extract<ClientMessage, { type: 'hello' }>,
  ctx: Context,
): Result {
  const out: Outgoing[] = [];
  let m = msg.token === undefined ? undefined : room.members.find((x) => x.token === msg.token);
  if (m) {
    // Back with a known token: the seat is theirs again, and a bot stops playing for them.
    m.name = msg.name;
    const g = room.game;
    if (g && m.seat !== null && g.away[m.seat]) {
      g.away[m.seat] = false;
      if (g.state.current === m.seat) g.clock = ctx.now;
    }
    // A host coming back gets its duty again on this socket.
    if (g && room.host === m.id) g.duty = null;
  } else {
    if (room.members.length >= MAX_MEMBERS) {
      const gone = room.members.find((x) => !x.connected && x.seat === null);
      if (!gone) return { room, out: [error('the room is full')] };
      room.members = room.members.filter((x) => x !== gone);
    }
    m = {
      id: `m${room.nextMember++}`,
      token: randomToken(ctx.random),
      name: msg.name,
      seat: null,
      connected: false,
      lastSeen: ctx.now,
    };
    room.members.push(m);
    if (room.phase === 'lobby') {
      const open = room.seats.findIndex((s) => s.type === 'open');
      if (open >= 0) seat(room, m, open);
    }
  }
  m.connected = true;
  const game = room.game ? snapshot(room, m.seat, ctx.history()) : null;
  syncHost(room);
  out.push({
    to: null,
    msg: {
      type: 'welcome',
      you: { id: m.id, token: m.token },
      room: roomInfo(room, ctx.now),
      game,
    },
  });
  return finish(before, room, out, ctx.now, { member: m.id });
}

function start(before: string, room: Room, m: Member, ctx: Context): Result {
  const out: Outgoing[] = [];
  if (room.phase !== 'lobby' || room.host !== m.id)
    return { room, out: [error('only the host can start the game', 'denied')] };
  if (room.seats.some((s) => s.type === 'open'))
    return { room, out: [error('fill or remove the open seats first', 'denied')] };
  if (!room.seats.some((s) => s.type === 'human'))
    return { room, out: [error('at least one person must play', 'denied')] };
  const players = room.players;
  const config: GameConfig = { players, firstPlayer: Math.floor(ctx.random() * players) };
  const seed = Math.floor(ctx.random() * 2 ** 32) >>> 0;
  const state = initialState(config, seed);
  room.phase = 'playing';
  room.game = {
    config,
    seed,
    length: 0,
    state,
    floor: state,
    tail: [],
    removed: Array.from({ length: players }, () => []),
    away: Array.from({ length: players }, () => false),
    clock: ctx.now,
    duty: null,
    ended: null,
  };
  for (const x of connected(room))
    out.push({ to: x.id, msg: { type: 'game', game: snapshot(room, x.seat, []) } });
  return finish(before, room, out, ctx.now, { truncate: 0 });
}

function act(
  before: string,
  room: Room,
  current: Room,
  m: Member,
  action: Action,
  at: number,
  ctx: Context,
): Result {
  const out: Outgoing[] = [];
  const g = room.game;
  if (room.phase !== 'playing' || !g)
    return { room: current, out: [error('no game running', 'denied')] };
  if (at !== g.length) return { room: current, out: [error('the game has moved on', 'stale')] };
  const p = action.player;
  const s = room.seats[p];
  let auto = false;
  if (s?.type === 'human' && s.member === m.id) {
    // Playing in person ends a takeover.
    g.away[p] = false;
  } else if (room.host === m.id && (s?.type === 'bot' || (s?.type === 'human' && g.away[p]))) {
    auto = true;
  } else {
    return { room: current, out: [error('you do not play that seat now', 'denied')] };
  }
  const reason = validateAction(g.state, action);
  if (reason) return { room: current, out: [error(reason, 'invalid')] };

  const { state, events } = apply(g.state, action);
  const entry: LogEntry = auto ? { action, events, auto: true } : { action, events };
  for (const e of events)
    if (e.type === 'castleAttacked' && e.won && e.defender !== null && e.shield !== null)
      g.removed[e.defender]!.push(e.shield);
  g.state = state;
  g.length++;
  g.clock = ctx.now;
  // Moves can be taken back by the person who made them; anything else (or a bot's move) is final.
  if (action.type === 'move' && !auto) g.tail.push(action);
  else {
    g.floor = state;
    g.tail = [];
  }
  if (state.phase === 'over') {
    room.phase = 'over';
    g.ended = ctx.now;
  }
  for (const x of connected(room))
    out.push({
      to: x.id,
      msg: { type: 'action', at: g.length - 1, entry, view: viewFor(state, x.seat) },
    });
  return finish(before, room, out, ctx.now, { append: [entry] });
}

function undo(
  before: string,
  room: Room,
  current: Room,
  m: Member,
  to: number,
  at: number,
  ctx: Context,
): Result {
  const out: Outgoing[] = [];
  const g = room.game;
  if (room.phase !== 'playing' || !g)
    return { room: current, out: [error('no game running', 'denied')] };
  if (at !== g.length) return { room: current, out: [error('the game has moved on', 'stale')] };
  const p = g.state.current;
  const s = room.seats[p];
  if (s?.type !== 'human' || s.member !== m.id || g.away[p])
    return { room: current, out: [error('only the player to move can undo', 'denied')] };
  const floor = g.length - g.tail.length;
  if (to < floor || to >= g.length)
    return { room: current, out: [error('nothing to undo there', 'denied')] };
  const tail = g.tail.slice(0, to - floor);
  g.state = tail.reduce((state, a) => apply(state, a).state, g.floor);
  g.tail = tail;
  g.length = to;
  g.clock = ctx.now;
  for (const x of connected(room))
    out.push({ to: x.id, msg: { type: 'undone', length: to, view: viewFor(g.state, x.seat) } });
  return finish(before, room, out, ctx.now, { truncate: to });
}

/** The last socket of a member closed. */
export function disconnect(current: Room, id: string, ctx: Pick<Context, 'now'>): Result {
  const room = structuredClone(current);
  const before = infoKey(current);
  const m = member(room, id);
  if (!m || !m.connected) return { room: current, out: [] };
  m.connected = false;
  m.lastSeen = ctx.now;
  return finish(before, room, [], ctx.now);
}

/**
 * Marks exactly the members in `live` as connected, e.g. after the Durable
 * Object restarted and its stored flags may be stale.
 */
export function reconcile(current: Room, live: ReadonlySet<string>, now: number): Room {
  if (current.members.every((m) => m.connected === live.has(m.id))) return current;
  const room = structuredClone(current);
  for (const m of room.members) {
    if (m.connected && !live.has(m.id)) m.lastSeen = now;
    m.connected = live.has(m.id);
  }
  return room;
}

/** The alarm: expire the room, let a bot take over an idle player, move AI duty on. */
export function tick(current: Room, ctx: Pick<Context, 'now'>): Result {
  const now = ctx.now;
  if (now >= expiry(current)) {
    const out: Outgoing[] = connected(current).map((m) => ({
      to: m.id,
      msg: { type: 'closed', reason: 'The room has expired.' },
    }));
    return { room: current, out, destroy: true };
  }
  const room = structuredClone(current);
  const before = infoKey(current);
  const out: Outgoing[] = [];
  const g = room.game;
  const due = deadline(room);
  if (g && due !== null && now >= due) g.away[g.state.current] = true;
  if (g?.duty && now >= g.duty.since + TIMING.botTimeout) {
    // The AI host did not answer: try the next eligible human, or ask again.
    const eligible = eligibleHosts(room);
    const i = eligible.findIndex((x) => x.id === room.host);
    const next = eligible[(i + 1) % eligible.length];
    if (next && next.id !== room.host) room.host = next.id;
    else g.duty = { ...g.duty, at: -1 }; // sends it again
  }
  return finish(before, room, out, now);
}
