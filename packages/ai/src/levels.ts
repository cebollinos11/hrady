import { heuristicBot, mctsBot, randomBot, type Bot } from './bots';

/** Difficulty levels offered to players. */
export type Level = 'easy' | 'medium' | 'hard';

export const LEVELS: readonly Level[] = ['easy', 'medium', 'hard'];

export const LEVEL_NAMES: Record<Level, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export interface LevelOptions {
  /** Thinking time per decision of the hard bot, in milliseconds. */
  timeMs?: number;
}

/**
 * The bot for a difficulty level: easy is the random bot, medium the heuristic
 * planner and hard the Monte-Carlo search over the heuristic's plans.
 */
export function createBot(level: Level, seed: number, options: LevelOptions = {}): Bot {
  switch (level) {
    case 'easy':
      return randomBot(seed);
    case 'medium':
      return heuristicBot(seed);
    case 'hard':
      return mctsBot(seed, options.timeMs === undefined ? {} : { timeMs: options.timeMs });
  }
}
