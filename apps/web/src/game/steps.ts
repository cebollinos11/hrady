import type { Contribution, GameEvent, PlayerId } from '@hrady/engine';

/**
 * Animation steps for the 3D board, planned from engine events. Events carry
 * no hidden values, so every viewer gets the same steps. `countsAfter` tells
 * how many knights the board shows on each node once a step has played, so
 * the scene can tween the moving figures between two consistent pictures.
 */
export type Step =
  | { kind: 'roll'; player: PlayerId; value: number }
  | { kind: 'place'; player: PlayerId; start: string }
  /** The start area holds the player's own knight: a ghost waits there until it has stepped off. */
  | { kind: 'spawnPending'; player: PlayerId; start: string }
  /** The knight on the start area cannot step off, so no new one spawns. */
  | { kind: 'blocked'; player: PlayerId; start: string }
  /** Knights walking onto `to`; with `battle`, beating the defenders there first. */
  | {
      kind: 'travel';
      player: PlayerId;
      sources: Contribution[];
      to: string;
      battle: { defender: PlayerId; defeated: number } | null;
    }
  | {
      kind: 'siege';
      player: PlayerId;
      castle: string;
      from: string;
      attackers: number;
      defender: PlayerId | null;
      garrison: number;
      shield: number | null;
      won: boolean;
    }
  | { kind: 'enter'; player: PlayerId; castle: string; from: string; count: number }
  | { kind: 'shield'; player: PlayerId; castle: string }
  | { kind: 'turn'; player: PlayerId; next: PlayerId }
  | { kind: 'over'; player: PlayerId; winners: PlayerId[]; points: number[] };

export function planSteps(events: readonly GameEvent[]): Step[] {
  return events
    .map((e): Step => {
      switch (e.type) {
        case 'rolled':
          return { kind: 'roll', player: e.player, value: e.value };
        case 'knightPlaced':
          return { kind: 'place', player: e.player, start: e.start };
        case 'spawnBlocked':
          return { kind: 'spawnPending', player: e.player, start: e.start };
        case 'placementSkipped':
          return { kind: 'blocked', player: e.player, start: e.start };
        case 'moved':
          return {
            kind: 'travel',
            player: e.player,
            sources: [{ from: e.from, count: e.count }],
            to: e.to,
            battle: null,
          };
        case 'fieldBattle':
          return {
            kind: 'travel',
            player: e.player,
            sources: e.contributions,
            to: e.target,
            battle: { defender: e.defender, defeated: e.defeated },
          };
        case 'castleAttacked':
          return {
            kind: 'siege',
            player: e.player,
            castle: e.castle,
            from: e.from,
            attackers: e.attackers,
            defender: e.defender,
            garrison: e.garrison,
            shield: e.shield,
            won: e.won,
          };
        case 'castleConquered':
          // The knights come from the marker the attack was made from: the
          // castle attack event right before this one names it.
          return { kind: 'enter', player: e.player, castle: e.castle, from: '', count: e.count };
        case 'shieldPlaced':
          return { kind: 'shield', player: e.player, castle: e.castle };
        case 'turnEnded':
          return { kind: 'turn', player: e.player, next: e.next };
        case 'gameOver':
          return { kind: 'over', player: e.player, winners: e.winners, points: e.points };
      }
    })
    .map((step, i, all) => {
      if (step.kind !== 'enter') return step;
      const siege = all[i - 1];
      return { ...step, from: siege?.kind === 'siege' ? siege.from : '' };
    });
}

export type Knights = Record<string, number[]>;

function add(knights: Knights, node: string, player: PlayerId, n: number) {
  if (!node) return;
  const counts = [...(knights[node] ?? [])];
  while (counts.length <= player) counts.push(0);
  counts[player] = Math.max(0, counts[player]! + n);
  if (counts.some((c) => c > 0)) knights[node] = counts;
  else delete knights[node];
}

function clear(knights: Knights, node: string, player: PlayerId | null) {
  const counts = knights[node];
  if (!counts) return;
  if (player === null) delete knights[node];
  else add(knights, node, player, -(counts[player] ?? 0));
}

/**
 * The knights on the board after `step`, from the knights before it. Counts
 * are per node and player like `GameState.knights`; empty nodes have no entry.
 * Does not modify its input.
 */
export function countsAfter(before: Knights, step: Step): Knights {
  const knights: Knights = { ...before };
  switch (step.kind) {
    case 'place':
      add(knights, step.start, step.player, 1);
      break;
    case 'travel':
      if (step.battle) clear(knights, step.to, step.battle.defender);
      for (const { from, count } of step.sources) {
        add(knights, from, step.player, -count);
        add(knights, step.to, step.player, count);
      }
      break;
    case 'siege':
      if (step.won) clear(knights, step.castle, null);
      else clear(knights, step.from, step.player);
      break;
    case 'enter':
      add(knights, step.from, step.player, -step.count);
      add(knights, step.castle, step.player, step.count);
      break;
  }
  return knights;
}

/**
 * How a siege splits into its parts, in milliseconds at normal speed: the
 * lunge, the shield flip (only when the castle has one) and the outcome.
 */
export function siegeTiming(step: { shield: number | null }) {
  const lunge = 450;
  const reveal = step.shield === null ? 0 : 900;
  const outcome = 700;
  return { lunge, reveal, outcome, total: lunge + reveal + outcome };
}

/** The attackers needed to take a castle: twice its defenders and shield. */
export function siegeNeed(step: { garrison: number; shield: number | null }): number {
  return 2 * (step.garrison + (step.shield ?? 0));
}

/** Milliseconds a step takes at normal speed; steps that only update the HUD take none. */
export function stepDuration(step: Step): number {
  switch (step.kind) {
    case 'roll':
      return 900;
    case 'place':
      return 500;
    case 'spawnPending':
      return 600;
    case 'blocked':
      return 600;
    case 'travel':
      return step.battle ? 1200 : 450;
    case 'siege':
      return siegeTiming(step).total;
    case 'enter':
      return 450;
    case 'shield':
      return 450;
    case 'turn':
    case 'over':
      return 0;
  }
}

/**
 * The knights left behind while the travellers of a step are on their way:
 * `before` without the knights that move (trips and castle entries).
 */
export function departed(before: Knights, step: Step): Knights {
  const knights: Knights = { ...before };
  if (step.kind === 'travel')
    for (const { from, count } of step.sources) add(knights, from, step.player, -count);
  if (step.kind === 'enter') add(knights, step.from, step.player, -step.count);
  return knights;
}
