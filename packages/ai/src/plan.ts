import { apply, boardContext, type Action, type GameState, type PlayerId } from '@hrady/engine';
import { candidates } from './candidates';
import { evaluate, type Perspective } from './evaluate';

/** Probability of each value of a player's face-down shield (`shieldDistribution`). */
export type ShieldOdds = (owner: PlayerId) => ReadonlyMap<number, number>;

export interface PlanOptions {
  /** States kept after each step of the search. */
  beam: number;
}

export interface Plan {
  /** Actions for the rest of the turn, without the final `endTurn`. */
  actions: Action[];
  /** Evaluation of the state the plan leads to (expected, after a gamble). */
  value: number;
}

/**
 * Whether to place a shield on a castle just conquered. Shields are few (six)
 * and drawn at random, so cheap castles only get one while plenty are left,
 * unless an enemy is close.
 */
export function wantsShield(state: GameState, castle: string): boolean {
  const left = state.shields[state.current]?.length ?? 0;
  if (left === 0) return false;
  const swords = boardContext(state.config).castleValue(castle);
  return swords >= 2 || left > 3 || neutralCount(state) <= 4;
}

const neutralCount = (state: GameState) =>
  Object.values(state.castles).filter((c) => c.owner === null).length;

/** Identity of a position: knights, castle owners, the pending shield and the MP left. */
export function positionKey(state: GameState, withMp = true): string {
  let key = `${state.turn}|${withMp ? state.mp : ''}|${state.pendingShield}|`;
  // Board order rather than sorting the occupied ids: same key, less work.
  for (const id of boardContext(state.config).order) {
    const counts = state.knights[id];
    if (counts) key += `${id}:${counts.join(',')};`;
  }
  for (const id in state.castles) key += `${state.castles[id]!.owner ?? '-'}`;
  return key;
}

/**
 * Whether an action's outcome hinges on a face-down shield the acting player
 * cannot see: an attack on another player's castle with a hidden shield.
 */
export function isGamble(state: GameState, action: Action): boolean {
  if (action.type !== 'attackCastle') return false;
  const c = state.castles[action.castle];
  return !!c && c.owner !== null && !!c.shield && !c.shield.revealed;
}

/** The state after `action`, followed by the shield decision when a castle was taken. */
function step(state: GameState, action: Action): { state: GameState; actions: Action[] } {
  const next = apply(state, action).state;
  if (next.pendingShield !== null && wantsShield(next, next.pendingShield)) {
    const shield: Action = {
      type: 'placeShield',
      player: next.current,
      castle: next.pendingShield,
    };
    return { state: apply(next, shield).state, actions: [action, shield] };
  }
  return { state: next, actions: [action] };
}

/**
 * Expected evaluation of a gamble on a face-down shield: the attack is played
 * out once for every value the shield may have.
 */
function gambleValue(
  state: GameState,
  action: Extract<Action, { type: 'attackCastle' }>,
  persp: Perspective,
  odds: ShieldOdds,
): number {
  const owner = state.castles[action.castle]!.owner!;
  let value = 0;
  for (const [shield, p] of odds(owner)) {
    const castle = state.castles[action.castle]!;
    const variant: GameState = {
      ...state,
      castles: {
        ...state.castles,
        [action.castle]: { ...castle, shield: { value: shield, revealed: false } },
      },
    };
    value += p * evaluate(step(variant, action).state, persp);
  }
  return value;
}

interface Node {
  state: GameState;
  actions: Action[];
  value: number;
}

/**
 * Plans the rest of a turn for the current player (in the move phase) with a
 * beam search over sequences of candidate actions, scoring each position with
 * {@link evaluate}. Ending the turn is possible after every step, so every
 * position seen is a possible plan. A gamble on a face-down shield ends a plan:
 * its value is the expectation over the shield, and the bot plans again once
 * the shield is revealed. Returns up to `count` plans, best first; the first
 * is always at least as good as ending the turn straight away. Plans whose
 * end positions differ by fewer than `diversity` knights from a better plan
 * are left out, so the list offers real alternatives.
 */
export function planTurns(
  state: GameState,
  persp: Perspective,
  odds: ShieldOdds,
  options: PlanOptions & { count: number; diversity?: number },
): Plan[] {
  const plans: Candidate[] = [{ actions: [], value: evaluate(state, persp), state }];
  if (state.phase !== 'move') return plans.map(({ actions, value }) => ({ actions, value }));

  let frontier: Node[] = [{ state, actions: [], value: plans[0]!.value }];
  // Positions already reached, with the most MP they were reached with.
  const seen = new Map([[positionKey(state, false), state.mp]]);
  while (frontier.length) {
    const children: Node[] = [];
    for (const node of frontier) {
      for (const action of candidates(node.state)) {
        if (action.type === 'endTurn' || action.type === 'placeShield') continue;
        if (action.type === 'attackCastle' && isGamble(node.state, action)) {
          const value = gambleValue(node.state, action, persp, odds);
          plans.push({ actions: [...node.actions, action], value, state: null });
          continue;
        }
        const next = step(node.state, action);
        const key = positionKey(next.state, false);
        if ((seen.get(key) ?? -1) >= next.state.mp) continue;
        seen.set(key, next.state.mp);
        const child: Node = {
          state: next.state,
          actions: [...node.actions, ...next.actions],
          value: evaluate(next.state, persp),
        };
        plans.push({ actions: child.actions, value: child.value, state: child.state });
        if (child.state.phase === 'move' && child.state.mp > 0) children.push(child);
      }
    }
    frontier = children.sort((a, b) => b.value - a.value).slice(0, options.beam);
  }
  plans.sort((a, b) => b.value - a.value);
  const chosen: Candidate[] = [];
  const diversity = options.diversity ?? 0;
  for (const plan of plans) {
    if (chosen.length === options.count) break;
    if (chosen.every((other) => knightsApart(plan.state, other.state) >= diversity))
      chosen.push(plan);
  }
  return chosen.map(({ actions, value }) => ({ actions, value }));
}

/** A plan with the position it ends in; `null` after a gamble, whose outcome is open. */
interface Candidate extends Plan {
  state: GameState | null;
}

/** How many knights stand in different places in two positions (∞ if either is open). */
function knightsApart(a: GameState | null, b: GameState | null): number {
  if (!a || !b) return Infinity;
  let diff = 0;
  for (const id in a.knights) {
    const x = a.knights[id]!;
    const y = b.knights[id];
    for (let p = 0; p < x.length; p++) diff += Math.abs(x[p]! - (y?.[p] ?? 0));
  }
  for (const id in b.knights) if (!a.knights[id]) for (const n of b.knights[id]!) diff += n;
  return diff / 2;
}

/** The best plan of {@link planTurns}. */
export function planTurn(
  state: GameState,
  persp: Perspective,
  odds: ShieldOdds,
  options: PlanOptions,
): Plan {
  return planTurns(state, persp, odds, { ...options, count: 1 })[0]!;
}
