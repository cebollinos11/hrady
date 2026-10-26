import { removedShields, type Level, type Observation } from '@hrady/ai';
import { viewFor, type GameState, type PlayerId } from '@hrady/engine';
import type { Session } from './session';

/** Who plays a seat: a person at this screen or a bot of some level. */
export type Seat = 'human' | Level;

export const SEAT_CHOICES: readonly Seat[] = ['human', 'easy', 'medium', 'hard'];

export const SEAT_NAMES: Record<Seat, string> = {
  human: 'Human',
  easy: 'Easy bot',
  medium: 'Medium bot',
  hard: 'Hard bot',
};

const isSeat = (v: unknown): v is Seat => SEAT_CHOICES.includes(v as Seat);

/** Seats for a game: the saved ones where they fit, humans elsewhere. */
export function seatsFor(players: number, saved: unknown = []): Seat[] {
  const list = Array.isArray(saved) ? saved : [];
  return Array.from({ length: players }, (_, p) => (isSeat(list[p]) ? list[p] : 'human'));
}

export const isBotTurn = (state: GameState, seats: readonly Seat[]) =>
  state.phase !== 'over' && (seats[state.current] ?? 'human') !== 'human';

/**
 * Whose eyes the board is shown through: the player to move if they are at
 * the screen, else the next human in turn order (the bots' moves are watched
 * from their side), or a spectator when every seat is a bot or the game is over.
 */
export function viewerFor(state: GameState, seats: readonly Seat[]): PlayerId | null {
  if (state.phase === 'over') return null;
  const players = state.config.players;
  for (let i = 0; i < players; i++) {
    const p = (state.current + i) % players;
    if ((seats[p] ?? 'human') === 'human') return p;
  }
  return null;
}

/** What the bot of `player` gets to see: its view and the public removed shields. */
export function observation(session: Session, player: PlayerId): Observation {
  const events = session.log.flatMap((entry) => entry.events);
  return {
    view: viewFor(session.state, player),
    removed: removedShields(events, session.state.config.players),
  };
}
