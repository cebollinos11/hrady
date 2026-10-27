import type { CastleView, GameState, GameView, PlayerId } from './types';

/**
 * What `viewer` may see: no RNG state, and face-down shields of other players
 * show no value. Pass `null` for a spectator, who sees no hidden values at all.
 */
export function viewFor(state: GameState, viewer: PlayerId | null): GameView {
  const knights: Record<string, number[]> = {};
  for (const id in state.knights) knights[id] = state.knights[id]!.slice();
  const castles: Record<string, CastleView> = {};
  for (const id in state.castles) {
    const c = state.castles[id]!;
    const visible = c.shield && (c.shield.revealed || c.owner === viewer);
    castles[id] = {
      owner: c.owner,
      shield: c.shield && { value: visible ? c.shield.value : null, revealed: c.shield.revealed },
    };
  }
  return {
    viewer,
    config: state.config,
    turn: state.turn,
    current: state.current,
    phase: state.phase,
    roll: state.roll,
    mp: state.mp,
    knights,
    castles,
    shieldsLeft: state.shields.map((s) => s.length),
    ownShields: viewer === null ? null : [...(state.shields[viewer] ?? [])],
    pendingShield: state.pendingShield,
    pendingSpawn: state.pendingSpawn,
    end: state.end && { ...state.end },
  };
}
