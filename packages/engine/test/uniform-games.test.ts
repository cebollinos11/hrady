import { describe, it } from 'vitest';
import { lcg, uniformBot } from './bot';
import { testBoardData } from './fixtures';
import { checkFinishedGame, playChecked } from './random-games';

describe('uniformly random games on the test board', () => {
  const board = testBoardData();
  for (let seed = 1; seed <= 100; seed++) {
    const config = { players: 3 + (seed % 3), board };
    it(`seed ${seed}`, () => {
      checkFinishedGame(config, seed, playChecked(config, seed, uniformBot(lcg(seed))));
    });
  }
});
