import { describe, expect, it } from 'vitest';
import { midGameState } from '../src/dev/demo';

describe('mid-game state', () => {
  it('gives each of four players two castles, a 20+ stack and several 10+ stacks', () => {
    const state = midGameState(5);
    for (let p = 0; p < 4; p++) {
      const owned = Object.values(state.castles).filter((c) => c.owner === p);
      expect(owned).toHaveLength(2);
      expect(owned.every((c) => c.shield !== null)).toBe(true);
      const stacks = Object.entries(state.knights)
        .filter(([id]) => !(id in state.castles))
        .map(([, counts]) => counts[p]!)
        .filter((n) => n > 0);
      expect(Math.max(...stacks)).toBeGreaterThanOrEqual(20);
      expect(stacks.filter((n) => n >= 10).length).toBeGreaterThanOrEqual(4);
      expect(stacks.filter((n) => n <= 2).length).toBeGreaterThanOrEqual(8);
    }
  });
});
