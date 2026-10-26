import {
  boardContext,
  holder,
  knightsAt,
  validateAction,
  visibleCastleDefence,
  type Action,
  type BoardContext,
  type Contribution,
  type GameState,
  type PlayerId,
} from '@hrady/engine';

export interface CandidateOptions {
  /**
   * Every count for moves and castle attacks, as `legalActions` lists them.
   * By default only a few useful counts are generated: the whole stack, all but
   * one, and a single knight (moves), or one, half and all (castle attacks).
   */
  allCounts?: boolean;
}

/** Knights a player may move off a node: all of them, but a castle keeps one. */
export function movable(state: GameState, ctx: BoardContext, node: string, player: PlayerId) {
  const n = knightsAt(state, node, player);
  return ctx.type(node) === 'castle' ? Math.max(0, n - 1) : n;
}

/** Whether `player` may step onto `node` without a fight. */
function canEnter(state: GameState, ctx: BoardContext, node: string, player: PlayerId) {
  const type = ctx.type(node);
  if (type === 'path') {
    const h = holder(state, node);
    return h === null || h === player;
  }
  return type === 'castle' && state.castles[node]?.owner === player;
}

const unique = (counts: number[], max: number) =>
  [...new Set(counts)].filter((n) => n >= 1 && n <= max).sort((a, b) => b - a);

function range(max: number): number[] {
  return Array.from({ length: max }, (_, i) => max - i);
}

/** Non-empty subsets of up to `max` items. */
function subsets<T>(items: readonly T[], max: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (picked.length) out.push(picked);
    if (picked.length === max) return;
    for (let i = start; i < items.length; i++) walk(i + 1, [...picked, items[i]!]);
  };
  walk(0, []);
  return out;
}

/** Most sources considered for one field attack; more never fit in 3 MP anyway. */
const MAX_SOURCES = 4;

/**
 * Field attacks on `target`: for every group of adjacent stacks that can win,
 * the all-in attack and the cheapest one (exactly one knight more than the
 * defenders, taken from the biggest stacks first).
 */
function fieldAttacks(
  state: GameState,
  ctx: BoardContext,
  player: PlayerId,
  target: string,
  defenders: number,
): Action[] {
  const sources = ctx
    .neighbours(target)
    .map((from) => ({ from, available: movable(state, ctx, from, player) }))
    .filter((s) => s.available > 0)
    .sort((a, b) => b.available - a.available)
    .slice(0, MAX_SOURCES);
  const out: Action[] = [];
  for (const group of subsets(sources, state.mp)) {
    const total = group.reduce((sum, s) => sum + s.available, 0);
    if (total <= defenders) continue;
    const allIn: Contribution[] = group.map((s) => ({ from: s.from, count: s.available }));
    out.push({ type: 'attackField', player, target, contributions: allIn });
    // Every stack sends one, then the biggest fill up to defenders + 1.
    let rest = defenders + 1 - group.length;
    const minimal = group.map((s) => {
      const extra = Math.max(0, Math.min(rest, s.available - 1));
      rest -= extra;
      return { from: s.from, count: 1 + extra };
    });
    if (minimal.some((c, i) => c.count !== allIn[i]!.count))
      out.push({ type: 'attackField', player, target, contributions: minimal });
  }
  return out;
}

/**
 * The actions a bot considers for the current player: shield placement, moves,
 * field attacks, castle attacks and the end of the turn. Unlike `legalActions`
 * it does not list every combination of attack counts. Every candidate is
 * checked with `validateAction`.
 */
export function candidates(state: GameState, options: CandidateOptions = {}): Action[] {
  const player = state.current;
  if (state.phase === 'over') return [];
  if (state.phase === 'roll') return [{ type: 'roll', player }];

  const ctx = boardContext(state.config);
  const out: Action[] = [];
  if (state.pendingShield !== null)
    out.push({ type: 'placeShield', player, castle: state.pendingShield });

  if (state.mp >= 1) {
    for (const from in state.knights) {
      const available = movable(state, ctx, from, player);
      if (available === 0) continue;
      const counts = options.allCounts
        ? range(available)
        : unique([available, available - 1, 1], available);
      for (const to of ctx.neighbours(from)) {
        if (!canEnter(state, ctx, to, player)) continue;
        for (const count of counts) out.push({ type: 'move', player, from, to, count });
      }
    }

    for (const target in state.knights) {
      if (ctx.type(target) !== 'path') continue;
      const defender = holder(state, target);
      if (defender === null || defender === player) continue;
      out.push(...fieldAttacks(state, ctx, player, target, knightsAt(state, target, defender)));
    }

    for (const castle of ctx.castleIds) {
      if (state.castles[castle]?.owner === player) continue;
      const needed = 2 * visibleCastleDefence(state, ctx, castle);
      for (const from of ctx.neighbours(castle)) {
        if (ctx.type(from) !== 'path') continue;
        const attackers = knightsAt(state, from, player);
        if (attackers === 0 || attackers < needed) continue;
        const counts = options.allCounts
          ? range(attackers)
          : unique([attackers, Math.ceil(attackers / 2), 1], attackers);
        for (const count of counts) out.push({ type: 'attackCastle', player, castle, from, count });
      }
    }
  }

  out.push({ type: 'endTurn', player });
  return out.filter((a) => validateAction(state, a) === null);
}
