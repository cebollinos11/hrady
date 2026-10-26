import { viewFor } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { scenario, testBoardData } from '../../engine/test/fixtures';
import {
  DEFAULT_SEARCH,
  LEVELS,
  createBot,
  createRandom,
  heuristicBot,
  mctsBot,
  perspective,
  playMatch,
  randomBot,
  searchTurn,
  shieldOdds,
  type Bot,
} from '../src';

const board = testBoardData();
const fast = { iterations: 12, rounds: 1, timeMs: Infinity };

describe('bots', () => {
  it('play whole games on the fixture board with legal actions only', { timeout: 30_000 }, () => {
    const lineups: Bot[][] = [
      [randomBot(1), heuristicBot(2), mctsBot(3, fast)],
      [heuristicBot(4), heuristicBot(5), heuristicBot(6), randomBot(7)],
    ];
    for (const [i, bots] of lineups.entries()) {
      // playMatch applies every action through the engine, which throws on illegal ones.
      const result = playMatch({ players: bots.length, board }, 10 + i, bots, { maxTurns: 400 });
      expect(result.finished).toBe(true);
    }
  });

  it('are reproducible from their seeds', () => {
    const game = () =>
      playMatch({ players: 3, board }, 5, [mctsBot(1, fast), heuristicBot(2), randomBot(3)], {
        maxTurns: 30,
      }).actions;
    expect(game()).toEqual(game());
  });

  // The real comparison is the tournament script; this is one quick game.
  it('beat the random bot (heuristic, one game on the Hrady board)', { timeout: 60_000 }, () => {
    const bots = [randomBot(1), heuristicBot(2), randomBot(3)];
    const { winners } = playMatch({ players: 3 }, 1, bots, { maxTurns: 1500 });
    expect(winners).toEqual([1]);
  });

  it('exist for every level', () => {
    const state = scenario({ knights: { c: { 0: 6 } } });
    for (const level of LEVELS) {
      const bot = createBot(level, 1, { timeMs: 50 });
      expect(bot.act({ view: viewFor(state, 0) }).type).not.toBe('roll');
    }
  });
});

describe('Monte-Carlo search', () => {
  const state = scenario({ knights: { a: { 0: 3 }, c: { 0: 2 }, b: { 1: 2 }, h: { 2: 3 } } });
  const obs = { view: viewFor(state, 0) };

  it('spends its simulations on the plans and keeps the best', () => {
    const options = { ...DEFAULT_SEARCH, iterations: 40, timeMs: Infinity };
    const result = searchTurn(obs, perspective(obs), shieldOdds(obs), createRandom(1), options);
    const visits = result.stats.reduce((sum, s) => sum + s.visits, 0);
    expect(result.stats.length).toBeGreaterThan(1);
    expect(visits).toBeLessThanOrEqual(40);
    expect(visits).toBeGreaterThan(result.stats.length);
    // Sequential halving: the chosen plan was simulated the most.
    const chosen = result.stats.find((s) => s.plan === result.plan)!;
    expect(Math.max(...result.stats.map((s) => s.visits))).toBe(chosen.visits);
  });

  it('stops when its time is up', () => {
    let clock = 0;
    const options = {
      ...DEFAULT_SEARCH,
      iterations: 10_000,
      timeMs: 100,
      now: () => (clock += 60),
    };
    const result = searchTurn(obs, perspective(obs), shieldOdds(obs), createRandom(1), options);
    const visits = result.stats.reduce((sum, s) => sum + s.visits, 0);
    expect(visits).toBeLessThanOrEqual(result.stats.length);
  });
});
