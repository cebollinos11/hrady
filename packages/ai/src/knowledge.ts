import type { CastleState, GameEvent, GameState, GameView, PlayerId } from '@hrady/engine';
import { shuffled, type Random } from './random';

/**
 * What a bot knows when it has to act: the redacted view of the seat it plays
 * (`view.viewer`), plus public history the view alone does not keep.
 */
export interface Observation {
  view: GameView;
  /**
   * Shield values removed from the game so far, per player. They were all
   * revealed by the attack that took the castle, so this is public; see
   * {@link removedShields}. Without it the bots assume nothing was removed,
   * which only makes their guesses about hidden shields a little vaguer.
   */
  removed?: readonly (readonly number[])[];
}

/** Shield values removed from the game, per player, from the public event log. */
export function removedShields(events: Iterable<GameEvent>, players: number): number[][] {
  const removed = Array.from({ length: players }, (): number[] => []);
  for (const e of events)
    if (e.type === 'castleAttacked' && e.won && e.defender !== null && e.shield !== null)
      removed[e.defender]!.push(e.shield);
  return removed;
}

/** Removes one occurrence of each of `values` from `pool` (in place). */
function takeOut(pool: number[], values: Iterable<number>): void {
  for (const v of values) {
    const i = pool.indexOf(v);
    if (i >= 0) pool.splice(i, 1);
  }
}

/**
 * Values `player`'s hidden shields (face-down on castles or not yet placed)
 * can have, as seen from the observation: the starting set minus every value
 * that is visible or known to be removed. For the viewer themselves this is
 * exact; for anyone else every hidden shield is a uniform draw from it.
 * `publicOnly` counts only face-up values, as a third player would.
 */
export function hiddenShieldPool(obs: Observation, player: PlayerId, publicOnly = false): number[] {
  const { view } = obs;
  if (player === view.viewer && view.ownShields && !publicOnly) {
    const pool = [...view.ownShields];
    for (const c of Object.values(view.castles))
      if (c.owner === player && c.shield && !c.shield.revealed && c.shield.value !== null)
        pool.push(c.shield.value);
    return pool;
  }
  const pool = [...view.config.rules.shieldValues];
  const visible: number[] = [];
  for (const { owner, shield } of Object.values(view.castles))
    if (owner === player && shield && shield.value !== null && (shield.revealed || !publicOnly))
      visible.push(shield.value);
  takeOut(pool, visible);
  takeOut(pool, obs.removed?.[player] ?? []);
  return pool;
}

/**
 * Expected value of a face-down shield of each player, from the viewer's side.
 * Bots use this instead of the value in a state, so a determinized state
 * never leaks into their evaluation. With `publicOnly`, the viewer's own
 * shields count as unknown too: what the other players can expect.
 */
export function expectedShields(obs: Observation, publicOnly = false): number[] {
  return Array.from({ length: obs.view.config.players }, (_, p) => {
    const pool = hiddenShieldPool(obs, p, publicOnly);
    return pool.length ? pool.reduce((a, b) => a + b, 0) / pool.length : 0;
  });
}

/**
 * Probability of each value of another player's face-down shield, as seen
 * from the observation.
 */
export function shieldDistribution(obs: Observation, player: PlayerId): Map<number, number> {
  const pool = hiddenShieldPool(obs, player);
  const dist = new Map<number, number>();
  for (const v of pool) dist.set(v, (dist.get(v) ?? 0) + 1 / pool.length);
  if (dist.size === 0) dist.set(0, 1);
  return dist;
}

/**
 * A full game state consistent with the observation: every hidden shield value
 * is sampled from what its owner may still have, and the engine RNG is a fresh
 * random seed. Nothing in it depends on information the viewer lacks.
 */
export function determinize(obs: Observation, random: Random): GameState {
  const { view } = obs;
  if (view.viewer === null) throw new Error('bots need the view of a seat, not a spectator view');
  const players = view.config.players;
  const castleIds = Object.keys(view.castles);
  const sampled = new Map<string, number>();
  const shields: number[][] = [];

  for (let p = 0; p < players; p++) {
    const hidden = castleIds.filter((id) => {
      const c = view.castles[id]!;
      return c.owner === p && c.shield !== null && c.shield.value === null;
    });
    const slots = hidden.length + view.shieldsLeft[p]!;
    const pool = p === view.viewer ? [] : shuffled(hiddenShieldPool(obs, p), random);
    // A wrong `removed` list could leave too few values; zeros keep the state usable.
    while (pool.length < slots) pool.push(0);
    hidden.forEach((id, i) => sampled.set(id, pool[i]!));
    shields.push(
      p === view.viewer
        ? [...(view.ownShields ?? [])]
        : pool.slice(hidden.length, hidden.length + view.shieldsLeft[p]!),
    );
  }
  const castles: Record<string, CastleState> = {};
  for (const id of castleIds) {
    const c = view.castles[id]!;
    const value = c.shield?.value ?? sampled.get(id) ?? 0;
    castles[id] = { owner: c.owner, shield: c.shield && { value, revealed: c.shield.revealed } };
  }

  const knights: Record<string, number[]> = {};
  for (const id in view.knights) knights[id] = view.knights[id]!.slice();
  return {
    config: view.config,
    rng: random.uint32(),
    turn: view.turn,
    current: view.current,
    phase: view.phase,
    roll: view.roll,
    mp: view.mp,
    knights,
    castles,
    shields,
    pendingShield: view.pendingShield,
    pendingSpawn: view.pendingSpawn,
    end: view.end && { ...view.end },
  };
}
