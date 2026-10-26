import { boardContext, knightsOnBoard } from './state';
import type { GameState, PlayerId, Score } from './types';

/**
 * Points per player: swords of held castles, plus the last neutral castle for
 * the player who ended the game. Valid mid-game as a running score.
 */
export function score(state: GameState): Score {
  const ctx = boardContext(state.config);
  const players = Array.from({ length: state.config.players }, (_, i) => i);
  const points = players.map(() => 0);
  for (const id of ctx.castleIds) {
    const owner = state.castles[id]?.owner;
    if (owner !== null && owner !== undefined) points[owner]! += ctx.castleValue(id);
  }
  if (state.end) points[state.end.player]! += ctx.castleValue(state.end.lastCastle);

  const knights = knightsOnBoard(state);
  const best = Math.max(...points);
  const leaders = players.filter((p) => points[p] === best);
  const most = Math.max(...leaders.map((p) => knights[p]!));
  const winners: PlayerId[] = leaders.filter((p) => knights[p] === most);
  return { points, knights, winners };
}
