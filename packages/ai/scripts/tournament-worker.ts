import { parentPort } from 'node:worker_threads';
import type { Bot } from '../src';
import { playMatch } from '../src';
import { botFromSpec } from './specs';

export interface GameJob {
  lineup: number;
  seed: number;
  /** Bot spec per seat. */
  specs: string[];
  /** Lineup entry per seat. */
  seats: number[];
  maxTurns: number;
}

export interface GameOutcome {
  lineup: number;
  seed: number;
  seats: number[];
  winners: number[];
  points: number[];
  turns: number;
  finished: boolean;
  /** Thinking time and decisions per seat. */
  ms: number[];
  decisions: number[];
}

/** Wraps a bot to measure its thinking time. */
function timed(bot: Bot, ms: number[], decisions: number[], seat: number): Bot {
  return {
    name: bot.name,
    act(obs) {
      const start = performance.now();
      const action = bot.act(obs);
      ms[seat]! += performance.now() - start;
      decisions[seat]! += 1;
      return action;
    },
  };
}

parentPort!.on('message', (job: GameJob) => {
  const players = job.specs.length;
  const ms = new Array<number>(players).fill(0);
  const decisions = new Array<number>(players).fill(0);
  const bots = job.specs.map((spec, seat) =>
    timed(botFromSpec(spec, job.seed * 31 + job.seats[seat]! * 7919), ms, decisions, seat),
  );
  const result = playMatch({ players }, job.seed, bots, { maxTurns: job.maxTurns });
  const outcome: GameOutcome = {
    lineup: job.lineup,
    seed: job.seed,
    seats: job.seats,
    winners: result.winners,
    points: result.points,
    turns: result.turns,
    finished: result.finished,
    ms,
    decisions,
  };
  parentPort!.postMessage(outcome);
});
