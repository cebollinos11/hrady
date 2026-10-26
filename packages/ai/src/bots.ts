import { apply, type Action, type GameState } from '@hrady/engine';
import { candidates } from './candidates';
import { DEFAULT_WEIGHTS, type Perspective, type Weights } from './evaluate';
import { determinize, expectedShields, shieldDistribution, type Observation } from './knowledge';
import { DEFAULT_SEARCH, searchTurn, type SearchOptions } from './mcts';
import { isGamble, planTurn, positionKey, wantsShield, type ShieldOdds } from './plan';
import { createRandom, pick } from './random';

/** A computer player. Bots may keep state between calls, so use one per seat. */
export interface Bot {
  readonly name: string;
  /** Chooses the next action for the seat that `obs.view` is redacted for. */
  act(obs: Observation): Action;
}

/** How a bot sees the state, from the observation alone. */
export function perspective(obs: Observation, weights: Weights = DEFAULT_WEIGHTS): Perspective {
  if (obs.view.viewer === null) throw new Error('bots need the view of a seat');
  return { player: obs.view.viewer, shields: expectedShields(obs), weights };
}

export function shieldOdds(obs: Observation): ShieldOdds {
  const cache = new Map<number, Map<number, number>>();
  return (owner) => {
    let odds = cache.get(owner);
    if (!odds) cache.set(owner, (odds = shieldDistribution(obs, owner)));
    return odds;
  };
}

/** Uniformly random among the candidate actions, every count included: the baseline. */
export function randomBot(seed: number): Bot {
  const random = createRandom(seed);
  return {
    name: 'random',
    act: (obs) => pick(candidates(determinize(obs, random), { allCounts: true }), random),
  };
}

/**
 * Plays a planned turn one action at a time. The rest of the plan is kept as
 * long as the position is the one it expects; a gamble on a hidden shield, or
 * anything unexpected, makes the bot plan again.
 */
export class PlanFollower {
  private expected: string | null = null;
  private rest: Action[] = [];

  /** The next planned action, if the plan still applies to `state`. */
  next(state: GameState): Action | null {
    if (this.expected !== positionKey(state) || this.rest.length === 0) return null;
    return this.follow(state, this.rest);
  }

  /** Starts following `actions` (the rest of the turn) and returns the first one. */
  follow(state: GameState, actions: readonly Action[]): Action {
    const [first, ...rest] = actions;
    if (!first) {
      this.expected = null;
      return { type: 'endTurn', player: state.current };
    }
    this.rest = rest;
    this.expected = isGamble(state, first) ? null : positionKey(apply(state, first).state);
    return first;
  }
}

export interface HeuristicOptions {
  /** States kept per step of the turn search. */
  beam?: number;
  weights?: Partial<Weights>;
}

/**
 * Plans each turn with a beam search over its actions (`planTurn`), scoring
 * positions with the evaluation in `evaluate.ts`.
 */
export function heuristicBot(seed: number, options: HeuristicOptions = {}): Bot {
  const random = createRandom(seed);
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const beam = options.beam ?? 8;
  const plan = new PlanFollower();
  return {
    name: 'heuristic',
    act(obs) {
      const state = determinize(obs, random);
      const player = state.current;
      if (state.phase === 'roll') return { type: 'roll', player };
      const planned = plan.next(state);
      if (planned) return planned;
      if (state.pendingShield !== null && wantsShield(state, state.pendingShield))
        return { type: 'placeShield', player, castle: state.pendingShield };
      const best = planTurn(state, perspective(obs, weights), shieldOdds(obs), { beam });
      return plan.follow(state, best.actions);
    },
  };
}

export interface MctsOptions extends Partial<SearchOptions> {
  weights?: Partial<Weights>;
}

/**
 * Chooses among the heuristic's best turn plans by playing each out in sampled
 * worlds (`searchTurn`): hidden shields are determinized, dice are rolled and
 * the opponents answer with heuristic play. Bounded by iterations and time.
 */
export function mctsBot(seed: number, options: MctsOptions = {}): Bot {
  const random = createRandom(seed);
  const { weights: w, ...search } = options;
  const weights = { ...DEFAULT_WEIGHTS, ...w };
  const settings = { ...DEFAULT_SEARCH, ...search };
  const plan = new PlanFollower();
  return {
    name: 'mcts',
    act(obs) {
      const state = determinize(obs, random);
      const player = state.current;
      if (state.phase === 'roll') return { type: 'roll', player };
      const planned = plan.next(state);
      if (planned) return planned;
      if (state.pendingShield !== null && wantsShield(state, state.pendingShield))
        return { type: 'placeShield', player, castle: state.pendingShield };
      const persp = perspective(obs, weights);
      const best = searchTurn(obs, persp, shieldOdds(obs), random, settings);
      return plan.follow(state, best.plan.actions);
    },
  };
}
