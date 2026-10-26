import { parseBoard } from '@hrady/board';
import type { GameEvent } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { testBoardData } from '../../../packages/engine/test/fixtures';
import { sinceLastTurn, summary, trailsOf } from '../src/game/recent';
import type { LogEntry } from '../src/shared/session';

const board = parseBoard(testBoardData());

/** A log entry with no meaningful action: only the events matter here. */
const entry = (...events: GameEvent[]): LogEntry => ({
  action: { type: 'endTurn', player: events[0]!.player },
  events,
});

const log: LogEntry[] = [
  entry({ type: 'moved', player: 0, from: 'a', to: 'b', count: 1 }),
  entry({ type: 'turnEnded', player: 0, next: 1 }),
  entry({ type: 'moved', player: 1, from: 'e', to: 'f', count: 2 }),
  entry({
    type: 'castleAttacked',
    player: 1,
    castle: 'keep',
    from: 'g',
    attackers: 2,
    defender: 0,
    garrison: 1,
    shield: null,
    won: true,
  }),
  entry({ type: 'turnEnded', player: 1, next: 2 }),
  entry({
    type: 'fieldBattle',
    player: 2,
    target: 'b',
    contributions: [
      { from: 'a', count: 1 },
      { from: 'c', count: 1 },
    ],
    defender: 0,
    defeated: 1,
  }),
  entry({ type: 'turnEnded', player: 2, next: 0 }),
  entry({ type: 'rolled', player: 0, value: 3 }),
];

describe('recent', () => {
  it('collects what the others did since the last turn of a player', () => {
    const events = sinceLastTurn(log, 0);
    expect(events.map((e) => e.type)).toEqual([
      'moved',
      'castleAttacked',
      'turnEnded',
      'fieldBattle',
      'turnEnded',
    ]);
    // A player who has not played yet sees everything the others did.
    expect(sinceLastTurn(log, 3)).toHaveLength(log.length);
  });

  it('draws moves, battles and castle attacks as trails', () => {
    expect(trailsOf(sinceLastTurn(log, 0))).toEqual([
      { player: 1, from: 'e', to: 'f', kind: 'move' },
      { player: 1, from: 'g', to: 'keep', kind: 'won' },
      { player: 2, from: 'a', to: 'b', kind: 'battle' },
      { player: 2, from: 'c', to: 'b', kind: 'battle' },
    ]);
  });

  it('sums up the battles for the player whose turn it is', () => {
    expect(summary(board, sinceLastTurn(log, 0), 0)).toBe(
      'Blue took Keep from you · Yellow beat 1 of your knights at road by Castle 7',
    );
    expect(summary(board, sinceLastTurn(log, 0), null)).toBe(
      "Blue took Keep from Red · Yellow beat 1 of Red's knights at road by Castle 7",
    );
    expect(summary(board, [log[0]!.events[0]!], 1)).toBeNull();
  });
});
