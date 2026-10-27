import type { GameState, GameView } from '@hrady/engine';
import type { GameSnapshot, LogEntry } from '@hrady/protocol';
import { isReversible, type Session } from '../shared/session';

/**
 * A `GameState` standing in for the server's, built from one player's view so
 * the local UI code (legal targets, selection, score, animations) runs
 * unchanged. Face-down shields the viewer cannot see count as 0 and other
 * players' unplaced shields as zeros: no rule that decides legality reads
 * them (a face-down shield counts as 0 for an attack anyway). It is never
 * used to apply actions; the server does that.
 */
export function stateFromView(view: GameView): GameState {
  const knights: Record<string, number[]> = {};
  for (const id in view.knights) knights[id] = view.knights[id]!.slice();
  const castles: GameState['castles'] = {};
  for (const [id, c] of Object.entries(view.castles))
    castles[id] = {
      owner: c.owner,
      shield: c.shield && { value: c.shield.value ?? 0, revealed: c.shield.revealed },
    };
  const shields = view.shieldsLeft.map((n, p) =>
    p === view.viewer && view.ownShields ? [...view.ownShields] : Array<number>(n).fill(0),
  );
  return {
    config: view.config,
    rng: 0,
    turn: view.turn,
    current: view.current,
    phase: view.phase,
    roll: view.roll,
    mp: view.mp,
    knights,
    castles,
    shields,
    pendingShield: view.pendingShield,
    pendingSpawn: view.pendingSpawn,
    end: view.end && { ...view.end },
  };
}

/** A session mirroring the server's game: the public log and a state from the view. */
export function mirror(view: GameView, log: readonly LogEntry[]): Session {
  return {
    record: {
      config: { players: view.config.players, firstPlayer: view.config.firstPlayer },
      seed: 0,
      actions: log.map((e) => e.action),
    },
    state: stateFromView(view),
    log: log.map(({ action, events }) => ({ action, events })),
  };
}

export const fromSnapshot = (game: GameSnapshot) => mirror(game.view, game.log);

/**
 * Number of log entries the server will not take back: up to the last action
 * that was not a plain move, or that a bot made for the seat.
 */
export function onlineFloor(log: readonly LogEntry[]): number {
  let i = log.length;
  while (i > 0 && isReversible(log[i - 1]!.action) && !log[i - 1]!.auto) i--;
  return i;
}
