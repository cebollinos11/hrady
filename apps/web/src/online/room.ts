import type { PlayerId } from '@hrady/engine';
import {
  asyncSeatProblem,
  type BotLevel,
  type RoomInfo,
  type RoomMode,
  type RoomStatus,
  type SeatInfo,
} from '@hrady/protocol';
import type { SeatLabel } from '../game/hud';

const LEVEL: Record<BotLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** How a seat is shown in the lobby and the HUD. */
export function seatName(seat: SeatInfo | undefined, me: string | null): string {
  if (!seat || seat.type === 'open') return 'Open';
  if (seat.type === 'bot') return `${LEVEL[seat.level]} bot`;
  return seat.member === me ? `${seat.name} (you)` : seat.name;
}

/** HUD labels for an online game. */
export function onlineLabels(room: RoomInfo, me: string | null): SeatLabel[] {
  return room.seats.map((s) => {
    if (s.type !== 'human') {
      const name = seatName(s, me);
      return { short: name.toLowerCase(), long: name };
    }
    const mine = s.member === me;
    const state = s.away ? ' · bot plays' : !s.connected ? ' · offline' : '';
    return {
      short: `${mine ? 'you' : s.name}${state}`,
      long: mine
        ? s.away
          ? 'a bot plays for you'
          : null
        : `${s.name}${s.away ? ' (bot plays)' : ''}`,
    };
  });
}

/** My seat in the room, `null` when watching. */
export const seatOf = (room: RoomInfo | null, me: string | null): PlayerId | null =>
  room?.members.find((m) => m.id === me)?.seat ?? null;

/** Why the host cannot start yet, or `null` when the game can start. */
export function startProblem(room: RoomInfo): string | null {
  if (room.seats.some((s) => s.type === 'open')) return 'Fill the open seats or make them bots.';
  if (!room.seats.some((s) => s.type === 'human')) return 'At least one person must play.';
  return room.mode === 'async' ? asyncSeatProblem(room.seats, room.host) : null;
}

/** One line of the "My games" list. */
export interface GameRow {
  code: string;
  mode: RoomMode;
  /** Where the game stands, e.g. "Your turn". */
  text: string;
  /** It is this browser's player to move: listed first and highlighted. */
  mine: boolean;
}

/** How a game looks in the list of this browser's games, from its status. */
export function describeGame({ room, me }: RoomStatus): GameRow {
  const row = (text: string, mine = false): GameRow => ({
    code: room.code,
    mode: room.mode,
    text,
    mine,
  });
  if (room.phase === 'lobby') return row('Waiting in the lobby');
  if (room.phase === 'over') return row('Finished');
  const mySeat = room.members.find((m) => m.id === me)?.seat ?? null;
  const turn = room.turn;
  const seat = turn === null ? undefined : room.seats[turn];
  if (turn === null || !seat) return row('Playing');
  if (mySeat === null) return row('Watching');
  if (turn === mySeat) return row('Your turn', true);
  if (seat.type === 'human') return row(`Waiting for ${seat.name}`);
  return row(
    room.host === me
      ? 'Computer players are next: open the game to play them'
      : 'Computer players are next: they play when the host opens the game',
  );
}

/** A countdown such as "1:05". */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
