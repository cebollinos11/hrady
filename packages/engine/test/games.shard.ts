import { describe, it } from 'vitest';
import { lcg, progressBot } from './bot';
import { GAMES_PER_SHARD, checkFinishedGame, playChecked } from './random-games';

/**
 * Seeded random-bot games on the Hrady board, split across shard files so
 * Vitest runs them in parallel. Every 10th game is also replayed.
 */
export function gamesShard(shard: number): void {
  describe(`random games on the Hrady board, shard ${shard}`, () => {
    for (let i = 0; i < GAMES_PER_SHARD; i++) {
      const seed = shard * GAMES_PER_SHARD + i + 1;
      const config = { players: 3 + (seed % 3) };
      it(`seed ${seed}, ${config.players} players`, () => {
        const run = playChecked(config, seed, progressBot(lcg(seed)));
        if (seed % 10 === 0) checkFinishedGame(config, seed, run);
      });
    }
  });
}
