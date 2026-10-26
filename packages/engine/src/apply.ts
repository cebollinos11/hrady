import { randomInt } from './rng';
import { castleDefence, validateAction } from './rules';
import { score } from './score';
import {
  addKnights,
  boardContext,
  copyState,
  editCastle,
  holder,
  initialState,
  knightsAt,
  neutralCastles,
  removeKnights,
} from './state';
import type { Action, ApplyResult, GameConfig, GameEvent, GameState, PlayerId } from './types';

export class IllegalActionError extends Error {
  constructor(
    readonly reason: string,
    readonly action: Action,
  ) {
    super(`illegal ${String(action?.type)}: ${reason}`);
    this.name = 'IllegalActionError';
  }
}

/** Gives a freshly conquered castle to `player`; ends the game on the next-to-last neutral one. */
function conquer(
  s: GameState,
  events: GameEvent[],
  player: PlayerId,
  castle: string,
  from: string,
  count: number,
): void {
  const c = editCastle(s, castle);
  const previousOwner = c.owner;
  removeKnights(s, from, player, count);
  addKnights(s, castle, player, count);
  c.owner = player;
  c.shield = null;
  events.push({ type: 'castleConquered', player, castle, previousOwner, count });

  const neutral = neutralCastles(s);
  if (previousOwner === null && neutral.length === 1) {
    s.phase = 'over';
    s.mp = 0;
    s.end = { player, lastCastle: neutral[0]! };
    const { points, winners } = score(s);
    events.push({ type: 'gameOver', player, lastCastle: neutral[0]!, points, winners });
  } else if (s.shields[player]!.length > 0) {
    s.pendingShield = castle;
  }
}

/**
 * Applies a legal action and returns the new state plus what happened. The
 * input state is not modified. Throws {@link IllegalActionError} otherwise.
 */
export function apply(state: GameState, action: Action): ApplyResult {
  const reason = validateAction(state, action);
  if (reason !== null) throw new IllegalActionError(reason, action);

  const ctx = boardContext(state.config);
  const s = copyState(state);
  const events: GameEvent[] = [];
  const { player } = action;
  // The shield may only be placed straight after the conquest.
  if (action.type !== 'placeShield') s.pendingShield = null;

  switch (action.type) {
    case 'roll': {
      const [die, rng] = randomInt(s.rng, 6);
      const value = die + 1;
      s.rng = rng;
      s.roll = value;
      s.phase = 'move';
      s.mp = s.config.rules.movePoints;
      events.push({ type: 'rolled', player, value });
      const start = ctx.board.startFor(value).id;
      if (knightsAt(s, start, player) > 0) {
        events.push({ type: 'placementSkipped', player, start });
      } else {
        addKnights(s, start, player, 1);
        events.push({ type: 'knightPlaced', player, start });
      }
      break;
    }

    case 'move': {
      const { from, to, count } = action;
      removeKnights(s, from, player, count);
      addKnights(s, to, player, count);
      s.mp -= 1;
      events.push({ type: 'moved', player, from, to, count });
      break;
    }

    case 'attackField': {
      const { target } = action;
      const contributions = action.contributions.map(({ from, count }) => ({ from, count }));
      const defender = holder(s, target)!;
      const defeated = knightsAt(s, target, defender);
      removeKnights(s, target, defender, defeated);
      for (const { from, count } of contributions) {
        removeKnights(s, from, player, count);
        addKnights(s, target, player, count);
      }
      s.mp -= contributions.length;
      events.push({ type: 'fieldBattle', player, target, contributions, defender, defeated });
      break;
    }

    case 'attackCastle': {
      const { castle, from, count } = action;
      const c = editCastle(s, castle);
      const defender = c.owner;
      const attackers = knightsAt(s, from, player);
      const garrison = defender === null ? ctx.castleValue(castle) : knightsAt(s, castle, defender);
      const won = attackers >= 2 * castleDefence(s, ctx, castle);
      s.mp -= 1;
      if (c.shield) c.shield.revealed = true;
      events.push({
        type: 'castleAttacked',
        player,
        castle,
        from,
        attackers,
        defender,
        garrison,
        shield: c.shield?.value ?? null,
        won,
      });
      if (!won) {
        removeKnights(s, from, player, attackers);
        break;
      }
      if (defender !== null) removeKnights(s, castle, defender, garrison);
      conquer(s, events, player, castle, from, count);
      break;
    }

    case 'placeShield': {
      const pool = [...s.shields[player]!];
      s.shields[player] = pool;
      const [index, rng] = randomInt(s.rng, pool.length);
      s.rng = rng;
      const [value] = pool.splice(index, 1);
      editCastle(s, action.castle).shield = { value: value!, revealed: false };
      s.pendingShield = null;
      events.push({ type: 'shieldPlaced', player, castle: action.castle });
      break;
    }

    case 'endTurn': {
      const next = (s.current + 1) % s.config.players;
      s.current = next;
      s.turn += 1;
      s.phase = 'roll';
      s.roll = null;
      s.mp = 0;
      events.push({ type: 'turnEnded', player, next });
      break;
    }
  }
  return { state: s, events };
}

/** Rebuilds a game from its seed and action log. */
export function replay(config: GameConfig, seed: number, actions: readonly Action[]): GameState {
  return actions.reduce((state, action) => apply(state, action).state, initialState(config, seed));
}

export function isTerminal(state: GameState): boolean {
  return state.phase === 'over';
}
