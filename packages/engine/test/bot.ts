import { boardContext, legalActions, type Action, type GameState } from '../src';

/** Small LCG for test bots, independent of the engine's RNG. */
export function lcg(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return Math.floor((s / 2 ** 32) * n);
  };
}

const pick = <T>(items: readonly T[], random: (n: number) => number): T =>
  items[random(items.length)]!;

/** Picks one of the legal actions it is given. */
export type Bot = (state: GameState, legal?: readonly Action[]) => Action;

/** A uniformly random legal action. */
export function uniformBot(random: (n: number) => number): Bot {
  return (state, legal = legalActions(state, state.current)) => pick(legal, random);
}

/**
 * Steps from each node to the nearest entrance of a neutral castle, walking
 * path markers and own castles.
 */
function distanceToTargets(state: GameState): Map<string, number> {
  const ctx = boardContext(state.config);
  const player = state.current;
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const castle of ctx.castleIds) {
    if (state.castles[castle]?.owner !== null) continue;
    for (const entrance of ctx.neighbours(castle)) {
      if (ctx.type(entrance) === 'path' && !dist.has(entrance)) {
        dist.set(entrance, 0);
        queue.push(entrance);
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    for (const next of ctx.neighbours(node)) {
      if (dist.has(next)) continue;
      const type = ctx.type(next);
      if (type === 'castle' && state.castles[next]?.owner !== player) continue;
      dist.set(next, dist.get(node)! + 1);
      if (type !== 'start') queue.push(next);
    }
  }
  return dist;
}

/**
 * Random legal play with a pull towards progress, so games finish in a few
 * hundred turns: it usually takes neutral castles and shields when offered,
 * sometimes attacks, and mostly moves whole stacks towards neutral castles. Every choice is still
 * drawn from {@link legalActions}.
 */
export function progressBot(random: (n: number) => number): Bot {
  return (state, actions = legalActions(state, state.current)) => {
    if (actions.length === 1) return actions[0]!;
    const of = <T extends Action['type']>(type: T) =>
      actions.filter((a): a is Extract<Action, { type: T }> => a.type === type);

    const castleAttacks = of('attackCastle');
    const neutral = castleAttacks.filter((a) => state.castles[a.castle]?.owner === null);
    if (neutral.length && random(10) < 9) return pick(neutral, random);
    if (castleAttacks.length && random(3) === 0) return pick(castleAttacks, random);
    const shields = of('placeShield');
    if (shields.length && random(10) < 8) return pick(shields, random);
    const fieldAttacks = of('attackField');
    if (fieldAttacks.length && random(4) === 0) return pick(fieldAttacks, random);

    const moves = of('move');
    if (moves.length === 0 || random(20) === 0) return pick(actions, random);
    if (random(10) < 8) {
      const dist = distanceToTargets(state);
      const far = Number.MAX_SAFE_INTEGER;
      const forward = moves.filter((m) => (dist.get(m.to) ?? far) < (dist.get(m.from) ?? far));
      if (forward.length) {
        // A random forward step, taking the whole movable stack along.
        const { from, to } = pick(forward, random);
        const same = forward.filter((m) => m.from === from && m.to === to);
        return same[same.length - 1]!;
      }
    }
    return pick(moves, random);
  };
}
