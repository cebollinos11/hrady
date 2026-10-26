import {
  apply,
  initialState,
  isTerminal,
  score,
  viewFor,
  type Action,
  type GameConfig,
  type PlayerId,
} from '@hrady/engine';
import type { Bot } from './bots';

export interface MatchOptions {
  /** Turn cap; a game reaching it counts as unfinished and is scored as it stands. */
  maxTurns?: number;
}

export interface MatchResult {
  winners: PlayerId[];
  points: number[];
  /** Turns played (all players). */
  turns: number;
  actions: Action[];
  /** `false` when the game hit the turn cap. */
  finished: boolean;
}

/**
 * Plays a game between bots, one per seat. Each bot only sees its seat's view
 * and the shields removed so far.
 */
export function playMatch(
  config: GameConfig,
  seed: number,
  bots: readonly Bot[],
  options: MatchOptions = {},
): MatchResult {
  const maxTurns = options.maxTurns ?? 2000;
  let state = initialState(config, seed);
  if (bots.length !== state.config.players)
    throw new Error(`${state.config.players} players need ${state.config.players} bots`);
  const removed = Array.from({ length: state.config.players }, (): number[] => []);
  const actions: Action[] = [];
  while (!isTerminal(state) && state.turn <= maxTurns) {
    const player = state.current;
    const action = bots[player]!.act({ view: viewFor(state, player), removed });
    const result = apply(state, action);
    for (const e of result.events)
      if (e.type === 'castleAttacked' && e.won && e.defender !== null && e.shield !== null)
        removed[e.defender]!.push(e.shield);
    actions.push(action);
    state = result.state;
  }
  const { winners, points } = score(state);
  return { winners, points, turns: state.turn, actions, finished: isTerminal(state) };
}
