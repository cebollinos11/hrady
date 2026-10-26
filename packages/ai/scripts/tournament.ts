/**
 * Bot-vs-bot tournament. Every lineup plays `--games` seeded games; seats
 * rotate from game to game so each bot sits in every seat equally often.
 *
 *   pnpm --filter @hrady/ai tournament --lineup heuristic,random,random --games 100
 *   pnpm --filter @hrady/ai tournament --lineup mcts,heuristic,heuristic --games 60
 *
 * Options: --lineup a,b,c (repeatable; 3–5 bots, see specs.ts), --games N,
 * --seed S (first game seed), --max-turns N, --workers N.
 */
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { GameJob, GameOutcome } from './tournament-worker';

interface Args {
  lineups: string[][];
  games: number;
  seed: number;
  maxTurns: number;
  workers: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    lineups: [],
    games: 30,
    seed: 1,
    maxTurns: 1000,
    workers: availableParallelism(),
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--') continue;
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--lineup') args.lineups.push(value.split(','));
    else if (flag === '--games') args.games = Number(value);
    else if (flag === '--seed') args.seed = Number(value);
    else if (flag === '--max-turns') args.maxTurns = Number(value);
    else if (flag === '--workers') args.workers = Number(value);
    else throw new Error(`unknown option ${flag}`);
  }
  if (args.lineups.length === 0) args.lineups.push(['heuristic', 'random', 'random']);
  for (const lineup of args.lineups)
    if (lineup.length < 3 || lineup.length > 5)
      throw new Error(`a lineup needs 3–5 bots: ${lineup.join(',')}`);
  return args;
}

/** Runs the jobs on a pool of worker threads, in any order. */
async function runAll(jobs: GameJob[], workers: number): Promise<GameOutcome[]> {
  const out: GameOutcome[] = [];
  const queue = [...jobs];
  const url = new URL('./tournament-worker.mjs', import.meta.url);
  let done = 0;
  const runWorker = () =>
    new Promise<void>((resolve, reject) => {
      const worker = new Worker(url);
      const next = () => {
        const job = queue.shift();
        if (job) worker.postMessage(job);
        else void worker.terminate().then(() => resolve());
      };
      worker.on('message', (outcome: GameOutcome) => {
        out.push(outcome);
        done++;
        process.stderr.write(`\r${done}/${jobs.length} games`);
        next();
      });
      worker.on('error', reject);
      next();
    });
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, runWorker));
  process.stderr.write('\n');
  return out;
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Markdown report of one lineup. */
function report(lineup: string[], outcomes: GameOutcome[]): string {
  const n = outcomes.length;
  const lines = [
    `### ${lineup.join(' vs ')} (${n} games, ${lineup.length} players)`,
    '',
    '| Seat in lineup | Bot | Wins | Win rate | Mean points | ms / decision |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  lineup.forEach((spec, i) => {
    let wins = 0;
    let points = 0;
    let ms = 0;
    let decisions = 0;
    for (const o of outcomes) {
      const seat = o.seats.indexOf(i);
      if (o.winners.includes(seat)) wins += 1 / o.winners.length;
      points += o.points[seat]!;
      ms += o.ms[seat]!;
      decisions += o.decisions[seat]!;
    }
    lines.push(
      `| ${i + 1} | \`${spec}\` | ${+wins.toFixed(2)} | ${pct(wins / n)} | ${(points / n).toFixed(1)} | ${(ms / Math.max(1, decisions)).toFixed(1)} |`,
    );
  });
  const turns = outcomes.map((o) => o.turns);
  const unfinished = outcomes.filter((o) => !o.finished).length;
  lines.push(
    '',
    `Game length in turns: mean ${(turns.reduce((a, b) => a + b, 0) / n).toFixed(0)}, ` +
      `median ${median(turns)}, min ${Math.min(...turns)}, max ${Math.max(...turns)}` +
      (unfinished ? `; ${unfinished} hit the turn cap.` : '.'),
    `Ties are split between the tied winners. Expected win rate without skill: ${pct(1 / lineup.length)}.`,
  );
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobs: GameJob[] = [];
  args.lineups.forEach((lineup, l) => {
    for (let g = 0; g < args.games; g++) {
      const players = lineup.length;
      // Lineup entry i sits in seat (i + g) % players.
      const seats = Array.from(
        { length: players },
        (_, seat) => (seat - g + players * g) % players,
      );
      const specs = seats.map((i) => lineup[i]!);
      jobs.push({ lineup: l, seed: args.seed + g, specs, seats, maxTurns: args.maxTurns });
    }
  });
  const started = Date.now();
  const outcomes = await runAll(jobs, args.workers);
  for (const [l, lineup] of args.lineups.entries()) {
    const mine = outcomes.filter((o) => o.lineup === l).sort((a, b) => a.seed - b.seed);
    console.log(`${report(lineup, mine)}\n`);
  }
  console.log(
    `Seeds ${args.seed}–${args.seed + args.games - 1}, ${((Date.now() - started) / 1000).toFixed(0)} s on ${args.workers} workers.`,
  );
}

await main();
