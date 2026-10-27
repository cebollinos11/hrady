import type { Action, GameEvent, GameView, PlayerId } from '@hrady/engine';

/**
 * Messages between the web client and the `GameRoom` Durable Object, as JSON
 * text frames on `/ws/:code`. Clients send intents; the server answers with
 * redacted views. Nothing the server sends carries the seed, the RNG state or
 * another player's face-down shield value.
 */

/** Bot difficulty, the same names as `Level` in `@hrady/ai`. */
export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard'];

/** Turn timer choices in seconds; 0 turns the idle timer off. */
export const TURN_SECONDS: readonly number[] = [0, 60, 120, 300];
export const DEFAULT_TURN_SECONDS = 120;

export const MAX_NAME_LENGTH = 20;
/** Longest client message the server reads, in characters. */
export const MAX_MESSAGE_LENGTH = 4096;

/** The text a client sends to keep its socket alive; the server answers `PONG` without waking up. */
export const PING = 'ping';
export const PONG = 'pong';

/** One applied action and its public events. `auto` marks actions a bot made for the seat. */
export interface LogEntry {
  action: Action;
  events: GameEvent[];
  auto?: true;
}

/**
 * What the bot of a seat needs: the seat's view and the shield values removed
 * from the game so far (public). Structurally an `Observation` of `@hrady/ai`.
 */
export interface BotObservation {
  view: GameView;
  removed: number[][];
}

/** A request to the AI host: play `seat` from the position after `at` actions. */
export interface Duty {
  seat: PlayerId;
  level: BotLevel;
  at: number;
  obs: BotObservation;
}

export type SeatInfo =
  | { type: 'open' }
  | {
      type: 'human';
      member: string;
      name: string;
      connected: boolean;
      /** A bot plays for this human until they are back. */
      away: boolean;
    }
  | { type: 'bot'; level: BotLevel };

export interface MemberInfo {
  id: string;
  name: string;
  /** `null` for a spectator. */
  seat: PlayerId | null;
  connected: boolean;
}

export type RoomPhase = 'lobby' | 'playing' | 'over';

/** The public state of a room: lobby, seats and who runs the bots. */
export interface RoomInfo {
  code: string;
  phase: RoomPhase;
  players: number;
  turnSeconds: number;
  /** Member who runs the lobby and the AI seats. */
  host: string | null;
  seats: SeatInfo[];
  members: MemberInfo[];
  /** Milliseconds until a bot takes over the player to move, if a timer runs. */
  deadlineIn: number | null;
}

/** A running or finished game as one client may see it. */
export interface GameSnapshot {
  view: GameView;
  /** Every action so far with its events (all public). */
  log: LogEntry[];
}

export type ClientMessage =
  /** First message on every socket. With a known token the member gets their seat back. */
  | { type: 'hello'; name: string; token?: string }
  /** Lobby: take an open seat (leaving the one held). */
  | { type: 'sit'; seat: PlayerId }
  /** Lobby: give up the seat and watch. */
  | { type: 'stand' }
  /** Host, lobby: make a seat open or a bot. A human there becomes a spectator. */
  | { type: 'setSeat'; seat: PlayerId; kind: 'open' | BotLevel }
  /** Host, lobby. */
  | { type: 'setOptions'; players?: number; turnSeconds?: number }
  /** Host, lobby: every seat taken and at least one human. */
  | { type: 'start' }
  /** Play an action; `at` is the number of actions the sender has seen. */
  | { type: 'act'; action: Action; at: number }
  /** Take back own moves: the game goes back to its first `to` actions. */
  | { type: 'undo'; to: number; at: number }
  /** Stop the bot that plays for me. */
  | { type: 'back' }
  /** Leave the room for good (the seat opens in the lobby). */
  | { type: 'leave' };

export type ServerMessage =
  | {
      type: 'welcome';
      you: { id: string; token: string };
      room: RoomInfo;
      game: GameSnapshot | null;
    }
  | { type: 'room'; room: RoomInfo }
  /** The game started. */
  | { type: 'game'; game: GameSnapshot }
  /** Action number `at` (0-based) was applied; `view` is the recipient's view after it. */
  | { type: 'action'; at: number; entry: LogEntry; view: GameView }
  /** Moves were taken back: the log now has `length` entries. */
  | { type: 'undone'; length: number; view: GameView }
  /** For the AI host: play this seat now, or stop (`null`). */
  | { type: 'duty'; duty: Duty | null }
  /** `stale` means the sender's `at` was behind; an update is on its way. */
  | { type: 'error'; message: string; code?: 'stale' | 'denied' | 'invalid' | 'unknown-room' }
  /** The room is gone (expired or finished); the socket closes. */
  | { type: 'closed'; reason: string };

/** Body of `POST /api/rooms`. */
export interface CreateRoomRequest {
  name: string;
  players?: number;
}

/** Answer to `POST /api/rooms`: keep the token to reconnect to the seat. */
export interface CreateRoomResponse {
  code: string;
  token: string;
}
