import { createBot, heuristicBot, mctsBot, randomBot, type Bot, type Level } from '../src';

/**
 * A bot from a spec like `random`, `heuristic:beam=4`, `mcts:iterations=200`
 * or a level (`easy`, `medium`, `hard`). Options are numbers, `w.<name>` sets
 * an evaluation weight (`heuristic:w.potential=5`). The MCTS bot gets
 * no time limit unless `timeMs` is given, so results only depend on seeds.
 */
export function botFromSpec(spec: string, seed: number): Bot {
  const [name = '', rest = ''] = spec.split(':');
  const options: Record<string, number> = {};
  const weights: Record<string, number> = {};
  for (const pair of rest.split(',').filter(Boolean)) {
    const [key, value] = pair.split('=');
    if (!key || value === undefined || Number.isNaN(Number(value)))
      throw new Error(`bad option "${pair}" in bot spec "${spec}"`);
    if (key.startsWith('w.')) weights[key.slice(2)] = Number(value);
    else options[key] = Number(value);
  }
  switch (name) {
    case 'random':
      return randomBot(seed);
    case 'heuristic':
      return heuristicBot(seed, { ...options, weights });
    case 'mcts':
      return mctsBot(seed, { timeMs: Infinity, ...options, weights });
    case 'easy':
    case 'medium':
    case 'hard':
      return createBot(name as Level, seed);
    default:
      throw new Error(`unknown bot "${name}" (random, heuristic, mcts, easy, medium, hard)`);
  }
}
