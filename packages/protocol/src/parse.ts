import { MAX_PLAYERS, MIN_PLAYERS, type Action, type Contribution } from '@hrady/engine';
import {
  BOT_LEVELS,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  ROOM_MODES,
  TURN_SECONDS,
  type BotLevel,
  type ClientMessage,
  type CreateRoomRequest,
  type ProfileUpdate,
  type RoomMode,
  type StatusRequest,
} from './messages';

/** Letters and digits that cannot be mistaken for each other (no 0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

/** A new room code from `random` (uniform in `[0, 1)`). */
export function makeCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++)
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** A room code as typed by a person, upper-cased; `null` if it cannot be one. */
export function normaliseCode(text: string): string | null {
  const code = text.trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

/** A display name: trimmed, inner whitespace collapsed, control characters removed. `null` if empty. */
export function normaliseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name ? [...name].slice(0, MAX_NAME_LENGTH).join('') : null;
}

export class ProtocolError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0, max = 1e9): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,32}$/.test(v);

function int(o: Obj, key: string, min = 0, max = 1e9): number {
  const v = o[key];
  if (!isInt(v, min, max)) throw new ProtocolError(`${key} must be an integer ${min}–${max}`);
  return v;
}

function id(o: Obj, key: string): string {
  const v = o[key];
  if (!isId(v)) throw new ProtocolError(`${key} must be a node id`);
  return v;
}

/**
 * An action rebuilt from untrusted JSON with only the fields the engine reads.
 * Checks the shape only; `validateAction` decides whether it is legal.
 */
export function parseAction(raw: unknown): Action {
  if (!isObj(raw)) throw new ProtocolError('action must be an object');
  const player = int(raw, 'player', 0, MAX_PLAYERS - 1);
  switch (raw.type) {
    case 'roll':
    case 'endTurn':
      return { type: raw.type, player };
    case 'move':
      return {
        type: 'move',
        player,
        from: id(raw, 'from'),
        to: id(raw, 'to'),
        count: int(raw, 'count', 1),
      };
    case 'attackField': {
      const list = raw.contributions;
      if (!Array.isArray(list) || list.length < 1 || list.length > 8)
        throw new ProtocolError('contributions must be a list of 1–8 entries');
      const contributions: Contribution[] = list.map((c: unknown) => {
        if (!isObj(c)) throw new ProtocolError('contribution must be an object');
        return { from: id(c, 'from'), count: int(c, 'count', 1) };
      });
      return { type: 'attackField', player, target: id(raw, 'target'), contributions };
    }
    case 'attackCastle':
      return {
        type: 'attackCastle',
        player,
        castle: id(raw, 'castle'),
        from: id(raw, 'from'),
        count: int(raw, 'count', 1),
      };
    case 'placeShield':
      return { type: 'placeShield', player, castle: id(raw, 'castle') };
    default:
      throw new ProtocolError('unknown action type');
  }
}

/** Parses and checks a client message. Throws `ProtocolError` with the reason. */
export function parseClientMessage(text: string): ClientMessage {
  if (text.length > MAX_MESSAGE_LENGTH) throw new ProtocolError('message too long');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProtocolError('message is not JSON');
  }
  if (!isObj(raw)) throw new ProtocolError('message must be an object');
  switch (raw.type) {
    case 'hello': {
      const name = normaliseName(raw.name);
      if (!name) throw new ProtocolError('a name is required');
      if (raw.token === undefined) return { type: 'hello', name };
      if (typeof raw.token !== 'string' || !/^[\w-]{8,64}$/.test(raw.token))
        throw new ProtocolError('malformed token');
      return { type: 'hello', name, token: raw.token };
    }
    case 'sit':
      return { type: 'sit', seat: int(raw, 'seat', 0, MAX_PLAYERS - 1) };
    case 'setSeat': {
      const kind = raw.kind;
      if (kind !== 'open' && !BOT_LEVELS.includes(kind as BotLevel))
        throw new ProtocolError('kind must be open, easy, medium or hard');
      return {
        type: 'setSeat',
        seat: int(raw, 'seat', 0, MAX_PLAYERS - 1),
        kind: kind as 'open' | BotLevel,
      };
    }
    case 'setOptions': {
      const out: ClientMessage = { type: 'setOptions' };
      if (raw.players !== undefined) out.players = int(raw, 'players', MIN_PLAYERS, MAX_PLAYERS);
      if (raw.turnSeconds !== undefined) {
        if (!TURN_SECONDS.includes(raw.turnSeconds as number))
          throw new ProtocolError(`turnSeconds must be one of ${TURN_SECONDS.join(', ')}`);
        out.turnSeconds = raw.turnSeconds as number;
      }
      return out;
    }
    case 'act':
      return { type: 'act', action: parseAction(raw.action), at: int(raw, 'at') };
    case 'undo':
      return { type: 'undo', to: int(raw, 'to'), at: int(raw, 'at') };
    case 'stand':
    case 'start':
    case 'back':
    case 'leave':
      return { type: raw.type };
    default:
      throw new ProtocolError('unknown message type');
  }
}

/** Parses the body of `POST /api/rooms`. */
export function parseCreateRoom(raw: unknown): CreateRoomRequest {
  if (!isObj(raw)) throw new ProtocolError('expected { name, players }');
  const name = normaliseName(raw.name);
  if (!name) throw new ProtocolError('a name is required');
  const out: CreateRoomRequest = { name };
  if (raw.players !== undefined) out.players = int(raw, 'players', MIN_PLAYERS, MAX_PLAYERS);
  if (raw.mode !== undefined) {
    if (!ROOM_MODES.includes(raw.mode as RoomMode))
      throw new ProtocolError(`mode must be one of ${ROOM_MODES.join(', ')}`);
    out.mode = raw.mode as RoomMode;
  }
  return out;
}

/**
 * The key of a username: the name as `normaliseName` reads it, lower-cased, so
 * "Ann" and "ann" are the same player. `null` if it cannot be a name.
 */
export function profileKey(text: string): string | null {
  const name = normaliseName(text);
  return name === null ? null : name.toLowerCase();
}

/** Parses the body of `POST /api/players/:name`. */
export function parseProfileUpdate(raw: unknown): ProfileUpdate {
  if (!isObj(raw)) throw new ProtocolError('expected { add } or { forget }');
  if (raw.forget !== undefined) {
    const code = typeof raw.forget === 'string' ? normaliseCode(raw.forget) : null;
    if (!code) throw new ProtocolError('forget must be a room code');
    return { forget: code };
  }
  const add = raw.add;
  if (!isObj(add)) throw new ProtocolError('expected { add } or { forget }');
  const code = typeof add.code === 'string' ? normaliseCode(add.code) : null;
  if (!code) throw new ProtocolError('add.code must be a room code');
  if (typeof add.token !== 'string' || !/^[\w-]{8,64}$/.test(add.token))
    throw new ProtocolError('malformed token');
  return { add: { code, token: add.token } };
}

/** Parses the body of `POST /api/rooms/:code/status`. */
export function parseStatusRequest(raw: unknown): StatusRequest {
  if (!isObj(raw) || typeof raw.token !== 'string' || !/^[\w-]{8,64}$/.test(raw.token))
    throw new ProtocolError('expected { token }');
  return { token: raw.token };
}
