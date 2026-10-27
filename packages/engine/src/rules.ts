import { boardContext, holder, knightsAt, type BoardContext } from './state';
import type { Action, Contribution, GameState, PlayerId } from './types';

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** Knights a player may move off a node: all of them, but a castle keeps one. */
export function movable(state: GameState, ctx: BoardContext, node: string, player: PlayerId) {
  const n = knightsAt(state, node, player);
  return ctx.type(node) === 'castle' ? Math.max(0, n - 1) : n;
}

/**
 * Whether a player may step onto a node without a fight: an empty or own path
 * marker, or their own castle. Start areas are never re-entered.
 */
function canEnter(state: GameState, ctx: BoardContext, node: string, player: PlayerId) {
  switch (ctx.type(node)) {
    case 'path': {
      const h = holder(state, node);
      return h === null || h === player;
    }
    case 'castle':
      return state.castles[node]?.owner === player;
    default:
      return false;
  }
}

/** Whether a knight on `start` has somewhere to step to, so a new one may spawn there. */
export function canStepOff(state: GameState, ctx: BoardContext, start: string, player: PlayerId) {
  return ctx.neighbours(start).some((to) => canEnter(state, ctx, to, player));
}

/** Defence of a castle: swords if neutral, else garrison plus shield. */
export function castleDefence(state: GameState, ctx: BoardContext, castle: string) {
  const c = state.castles[castle];
  if (!c || c.owner === null) return ctx.castleValue(castle);
  return knightsAt(state, castle, c.owner) + (c.shield?.value ?? 0);
}

/**
 * Defence as the attacker can see it: a face-down shield counts as 0. An attack
 * is legal when it could win, i.e. with at least twice this many knights.
 */
export function visibleCastleDefence(state: GameState, ctx: BoardContext, castle: string) {
  const c = state.castles[castle];
  if (!c || c.owner === null) return ctx.castleValue(castle);
  const shield = c.shield?.revealed ? c.shield.value : 0;
  return knightsAt(state, castle, c.owner) + shield;
}

function validateContributions(
  state: GameState,
  ctx: BoardContext,
  player: PlayerId,
  target: string,
  contributions: unknown,
): string | null {
  if (!Array.isArray(contributions) || contributions.length === 0)
    return 'an attack needs at least one contributing stack';
  if (contributions.length > state.mp)
    return `${contributions.length} stacks need ${contributions.length} MP, only ${state.mp} left`;
  const seen = new Set<string>();
  let total = 0;
  for (const c of contributions as Partial<Contribution>[]) {
    if (!c || !isId(c.from) || !isInt(c.count)) return 'malformed contribution';
    if (seen.has(c.from)) return `${c.from} contributes twice`;
    seen.add(c.from);
    if (!ctx.adjacent(c.from, target)) return `${c.from} is not adjacent to ${target}`;
    const available = movable(state, ctx, c.from, player);
    if (c.count < 1 || c.count > available)
      return `${c.from} can send 1–${available} knights, not ${c.count}`;
    total += c.count;
  }
  const defenders = knightsAt(state, target, holder(state, target) ?? player);
  if (total <= defenders) return `${total} attackers do not outnumber ${defenders} defenders`;
  return null;
}

/** Why an action is illegal, or `null` if it may be applied. */
export function validateAction(state: GameState, action: Action): string | null {
  if (typeof action !== 'object' || action === null || typeof action.type !== 'string')
    return 'malformed action';
  if (state.phase === 'over') return 'the game is over';
  if (action.player !== state.current) return `it is player ${state.current}'s turn`;
  if (action.type === 'roll') return state.phase === 'roll' ? null : 'already rolled this turn';
  if (state.phase !== 'move') return 'roll the die first';

  const ctx = boardContext(state.config);
  const player = action.player;
  if (state.pendingSpawn !== null && (action.type !== 'move' || action.from !== state.pendingSpawn))
    return `the knight on ${state.pendingSpawn} must move away first`;
  switch (action.type) {
    case 'endTurn':
      return null;

    case 'placeShield':
      if (state.pendingShield === null || action.castle !== state.pendingShield)
        return 'a shield may only be placed right after conquering that castle';
      return null;

    case 'move': {
      const { from, to, count } = action;
      if (!isId(from) || !isId(to) || !isInt(count)) return 'malformed move';
      if (state.mp < 1) return 'no movement points left';
      if (!ctx.adjacent(from, to)) return `${from} is not connected to ${to}`;
      const available = movable(state, ctx, from, player);
      if (available === 0) return `no knights to move from ${from}`;
      if (count < 1 || count > available)
        return `can move 1–${available} knights from ${from}, not ${count}`;
      if (!canEnter(state, ctx, to, player)) {
        if (ctx.type(to) === 'start') return 'knights may never re-enter a start area';
        if (ctx.type(to) === 'castle') return `${to} is not your castle; attack it instead`;
        return `${to} is held by another player; attack it instead`;
      }
      return null;
    }

    case 'attackField': {
      const { target } = action;
      if (!isId(target)) return 'malformed attack';
      if (state.mp < 1) return 'no movement points left';
      if (ctx.type(target) !== 'path') return 'field battles happen only on path markers';
      const defender = holder(state, target);
      if (defender === null || defender === player) return `${target} has no enemy knights`;
      return validateContributions(state, ctx, player, target, action.contributions);
    }

    case 'attackCastle': {
      const { castle, from, count } = action;
      if (!isId(castle) || !isId(from) || !isInt(count)) return 'malformed attack';
      if (state.mp < 1) return 'no movement points left';
      if (ctx.type(castle) !== 'castle') return `${castle} is not a castle`;
      if (state.castles[castle]?.owner === player) return `${castle} is already yours`;
      if (ctx.type(from) !== 'path' || !ctx.adjacent(from, castle))
        return `${from} is not an entrance of ${castle}`;
      const attackers = knightsAt(state, from, player);
      if (attackers === 0) return `no knights on ${from}`;
      const needed = 2 * visibleCastleDefence(state, ctx, castle);
      if (attackers < needed) return `${attackers} knights on ${from}, at least ${needed} needed`;
      if (count < 1 || count > attackers)
        return `can move 1–${attackers} knights into the castle, not ${count}`;
      return null;
    }

    default:
      return `unknown action type ${String((action as { type: unknown }).type)}`;
  }
}

/** All non-empty combinations of up to `max` items, in input order. */
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

/** Every way to send 1..available knights from each source, with a total above `defenders`. */
function contributionsFor(
  sources: readonly { from: string; available: number }[],
  defenders: number,
): Contribution[][] {
  const out: Contribution[][] = [];
  const walk = (i: number, picked: Contribution[], total: number) => {
    if (i === sources.length) {
      if (total > defenders) out.push(picked);
      return;
    }
    const { from, available } = sources[i]!;
    for (let count = 1; count <= available; count++)
      walk(i + 1, [...picked, { from, count }], total + count);
  };
  walk(0, [], 0);
  return out;
}

/** True when the current player has spent all movement points (and has no shield to place): the turn ends by itself. */
export const mustEndTurn = (state: GameState): boolean =>
  state.phase === 'move' && state.mp < 1 && state.pendingShield === null;

/**
 * Every legal action for `player`, in a stable order: shield placement, moves,
 * field attacks, castle attacks, end of turn. Empty when it is not their turn.
 */
export function legalActions(state: GameState, player: PlayerId): Action[] {
  if (state.phase === 'over' || player !== state.current) return [];
  if (state.phase === 'roll') return [{ type: 'roll', player }];

  const ctx = boardContext(state.config);
  const actions: Action[] = [];
  if (state.pendingSpawn !== null) {
    const from = state.pendingSpawn;
    for (const to of ctx.neighbours(from))
      if (canEnter(state, ctx, to, player))
        actions.push({ type: 'move', player, from, to, count: 1 });
    return actions;
  }
  if (state.pendingShield !== null)
    actions.push({ type: 'placeShield', player, castle: state.pendingShield });

  if (state.mp >= 1) {
    for (const from of ctx.order) {
      const available = movable(state, ctx, from, player);
      if (available === 0) continue;
      for (const to of ctx.neighbours(from)) {
        if (!canEnter(state, ctx, to, player)) continue;
        for (let count = 1; count <= available; count++)
          actions.push({ type: 'move', player, from, to, count });
      }
    }

    for (const target of ctx.order) {
      if (ctx.type(target) !== 'path') continue;
      const defender = holder(state, target);
      if (defender === null || defender === player) continue;
      const sources = ctx
        .neighbours(target)
        .map((from) => ({ from, available: movable(state, ctx, from, player) }))
        .filter((s) => s.available > 0);
      const defenders = knightsAt(state, target, defender);
      for (const group of subsets(sources, state.mp))
        for (const contributions of contributionsFor(group, defenders))
          actions.push({ type: 'attackField', player, target, contributions });
    }

    for (const castle of ctx.castleIds) {
      if (state.castles[castle]?.owner === player) continue;
      const needed = 2 * visibleCastleDefence(state, ctx, castle);
      for (const from of ctx.neighbours(castle)) {
        if (ctx.type(from) !== 'path') continue;
        const attackers = knightsAt(state, from, player);
        if (attackers === 0 || attackers < needed) continue;
        for (let count = 1; count <= attackers; count++)
          actions.push({ type: 'attackCastle', player, castle, from, count });
      }
    }
  }

  actions.push({ type: 'endTurn', player });
  return actions;
}
