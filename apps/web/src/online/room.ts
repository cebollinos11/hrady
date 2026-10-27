import type { PlayerId } from '@hrady/engine';
import type { BotLevel, RoomInfo, SeatInfo } from '@hrady/protocol';
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
  return null;
}

/** A countdown such as "1:05". */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
