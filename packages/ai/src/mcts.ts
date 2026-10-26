import { apply, validateAction, type Action, type GameState } from '@hrady/engine';
import { evaluate, type Perspective } from './evaluate';
import { determinize, expectedShields, type Observation } from './knowledge';
import { planTurn, planTurns, wantsShield, type Plan, type ShieldOdds } from './plan';
import { createRandom, type Random } from './random';

export interface SearchOptions {
  /** Turn plans from the heuristic search that compete at the root. */
  plans: number;
  /** Beam width of the heuristic search that proposes the plans. */
  beam: number;
  /** Knights by which the proposed plans' end positions must differ. */
  diversity: number;
  /** Simulations in total (a simulation plays one plan in one sampled world). */
  iterations: number;
  /** Time budget in milliseconds; the search stops at whichever limit comes first. */
  timeMs: number;
  /** Rounds of every player's turns simulated after the plan. */
  rounds: number;
  /** Beam width of the heuristic play inside simulations. */
  rolloutBeam: number;
  /** Evaluation units per logistic step when turning a position into a reward. */
  scale: number;
  /** Clock for the time budget. */
  now: () => number;
}

export const DEFAULT_SEARCH: SearchOptions = {
  plans: 8,
  beam: 8,
  diversity: 2,
  iterations: 400,
  timeMs: 2000,
  rounds: 1,
  rolloutBeam: 1,
  scale: 20,
  now: () => performance.now(),
};

export interface SearchResult {
  plan: Plan;
  /** Every candidate with its mean reward and number of simulations. */
  stats: { plan: Plan; mean: number; visits: number }[];
}

/** Applies the shield decision after a conquest, as the heuristic bot would. */
function settleShield(state: GameState): GameState {
  if (state.pendingShield === null || !wantsShield(state, state.pendingShield)) return state;
  const action: Action = {
    type: 'placeShield',
    player: state.current,
    castle: state.pendingShield,
  };
  return apply(state, action).state;
}

/**
 * Plays `plan` for the root player in a sampled world, then every player's
 * turns for `rounds` rounds with the heuristic planner, and scores the result
 * from the root player's side in `[0, 1]`. The world (hidden shields, dice) is
 * whatever the determinized state holds; the play is deterministic given it.
 */
function simulate(
  world: GameState,
  plan: readonly Action[],
  persp: Perspective,
  beliefs: readonly number[],
  odds: ShieldOdds,
  options: SearchOptions,
): number {
  let state = world;
  for (const action of plan) {
    if (state.phase !== 'move' || validateAction(state, action) !== null) break;
    state = apply(state, action).state;
  }
  if (state.phase === 'move') state = settleShield(state);

  const turns = options.rounds * state.config.players;
  for (let t = 0; t < turns && state.phase !== 'over'; t++) {
    if (state.phase === 'move')
      state = apply(state, { type: 'endTurn', player: state.current }).state;
    state = apply(state, { type: 'roll', player: state.current }).state;
    const player = state.current;
    if (player === persp.player && t === turns - 1) break;
    const view: Perspective = {
      ...persp,
      player,
      shields: player === persp.player ? persp.shields : beliefs,
    };
    const { actions } = planTurn(state, view, odds, { beam: options.rolloutBeam });
    for (const action of actions) {
      if (state.phase !== 'move' || validateAction(state, action) !== null) break;
      state = apply(state, action).state;
    }
  }
  const value = evaluate(state, persp);
  return 1 / (1 + Math.exp(-value / options.scale));
}

/**
 * Monte-Carlo search over turn plans with determinization of hidden
 * information. The heuristic planner proposes the best few plans for the turn;
 * each is played out in sampled worlds (hidden shields drawn from what their
 * owners may still have, fresh dice) followed by a round of heuristic play by
 * everyone, and judged by the evaluation at the end. The plans share their
 * sampled worlds (common random numbers) and are narrowed down by sequential
 * halving until the budget is spent.
 */
export function searchTurn(
  obs: Observation,
  persp: Perspective,
  odds: ShieldOdds,
  random: Random,
  options: SearchOptions = DEFAULT_SEARCH,
): SearchResult {
  const start = options.now();
  const root = determinize(obs, random);
  const plans = planTurns(root, persp, odds, {
    beam: options.beam,
    count: options.plans,
    diversity: options.diversity,
  });
  const stats = plans.map((plan) => ({ plan, mean: 0, visits: 0, sum: 0 }));
  const result = () => ({
    plan: [...stats].sort((a, b) => b.mean - a.mean)[0]!.plan,
    stats: stats.map(({ plan, mean, visits }) => ({ plan, mean, visits })),
  });
  if (plans.length < 2) return result();

  // Rollouts model the others with what any player can tell about shields.
  const beliefs = expectedShields(obs, true);
  const worldSeed = random.uint32();
  let alive = stats.map((_, i) => i);
  let samples = 0;
  let spent = 0;
  const rounds = Math.ceil(Math.log2(plans.length));
  for (let round = 0; round < rounds && alive.length > 1; round++) {
    const remaining = options.iterations - spent;
    const per = Math.max(1, Math.floor(remaining / (alive.length * (rounds - round))));
    for (let k = 0; k < per; k++, samples++) {
      if (options.now() - start > options.timeMs && samples > 0) break;
      const world = determinize(obs, createRandom(worldSeed + samples));
      for (const i of alive) {
        const s = stats[i]!;
        s.sum += simulate(world, s.plan.actions, persp, beliefs, odds, options);
        s.visits++;
        s.mean = s.sum / s.visits;
        spent++;
      }
    }
    alive.sort((a, b) => stats[b]!.mean - stats[a]!.mean);
    alive = alive.slice(0, Math.ceil(alive.length / 2));
    if (options.now() - start > options.timeMs) break;
  }
  const best = stats[alive[0]!]!;
  return { ...result(), plan: best.plan };
}
