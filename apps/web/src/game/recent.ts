import type { Board } from '@hrady/board';
import type { GameEvent, PlayerId } from '@hrady/engine';
import { placeName, playerName } from '../shared/describe';
import type { LogEntry } from '../shared/session';

/**
 * What the other players did since a player's last turn: the trails drawn on
 * the board and the short summary shown when their turn comes round.
 */

/** An arrow on the board from one node to another. */
export interface Trail {
  player: PlayerId;
  from: string;
  to: string;
  kind: 'move' | 'battle' | 'won' | 'lost';
}

/**
 * Events of the other players since `me` last ended a turn, oldest first.
 * Everything since the start of the game if `me` has not played yet.
 */
export function sinceLastTurn(log: readonly LogEntry[], me: PlayerId): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const events = log[i]!.events;
    for (let j = events.length - 1; j >= 0; j--) {
      const e = events[j]!;
      if (e.type === 'turnEnded' && e.player === me) return out.reverse();
      if (e.player !== me) out.push(e);
    }
  }
  return out.reverse();
}

export function trailsOf(events: readonly GameEvent[]): Trail[] {
  return events.flatMap((e): Trail[] => {
    switch (e.type) {
      case 'moved':
        return [{ player: e.player, from: e.from, to: e.to, kind: 'move' }];
      case 'fieldBattle':
        return e.contributions.map((c) => ({
          player: e.player,
          from: c.from,
          to: e.target,
          kind: 'battle',
        }));
      case 'castleAttacked':
        return [{ player: e.player, from: e.from, to: e.castle, kind: e.won ? 'won' : 'lost' }];
      default:
        return [];
    }
  });
}

/**
 * The battles of `events` in a few words, from the point of view of `me`
 * (`null` for a spectator), or `null` if there was none.
 */
export function summary(
  board: Board,
  events: readonly GameEvent[],
  me: PlayerId | null,
): string | null {
  const name = (id: string) => placeName(board, id);
  const whose = (p: PlayerId | null) =>
    p === null ? '' : p === me ? 'your ' : `${playerName(p)}'s `;
  const lines = events.flatMap((e): string[] => {
    const who = playerName(e.player);
    if (e.type === 'castleAttacked') {
      const from =
        e.defender === null
          ? ''
          : e.defender === me
            ? ' from you'
            : ` from ${playerName(e.defender)}`;
      return [
        e.won
          ? `${who} took ${name(e.castle)}${from}`
          : `${who} failed to take ${whose(e.defender)}${name(e.castle)}`,
      ];
    }
    if (e.type === 'fieldBattle')
      return [`${who} beat ${e.defeated} of ${whose(e.defender)}knights at ${name(e.target)}`];
    return [];
  });
  return lines.length ? lines.join(' · ') : null;
}
