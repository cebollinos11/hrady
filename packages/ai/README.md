# @hrady/ai

Computer players for Hrady: pure TypeScript on top of `@hrady/engine`, no DOM
and no I/O, so the same code runs in Node (tests, tournaments) and in a Web
Worker (the debug client).

```ts
import { createBot, removedShields } from '@hrady/ai';
import { viewFor } from '@hrady/engine';

const bot = createBot('hard', seed); // one bot per seat: bots keep their turn plan
const action = bot.act({ view: viewFor(state, seat), removed: removedShields(events, players) });
```

| Level  | Bot            | What it does                                                             |
| ------ | -------------- | ------------------------------------------------------------------------ |
| Easy   | `randomBot`    | uniformly random candidate action (the baseline)                         |
| Medium | `heuristicBot` | plans the whole turn with a beam search scored by a heuristic evaluation |
| Hard   | `mctsBot`      | plays the heuristic's best plans out in sampled worlds, keeps the best   |

## What a bot sees

`act(obs)` gets an `Observation`: `viewFor(state, seat)` (no RNG, other players'
face-down shields have `value: null`) and, optionally, `removed`: the shield
values taken out of the game per player. That list is public (every removed
shield was revealed by the attack that took its castle) but the view does not
keep it; `removedShields(events)` builds it from the event log. Without it the
bots only guess hidden shields a little less sharply.

`determinize(obs, random)` turns an observation into a full `GameState`: every
hidden shield value is drawn from what its owner may still have (the six
starting values minus every face-up and removed one), and the engine RNG gets a
fresh seed. The state is used for legality checks and simulation; the
evaluation never reads another player's face-down value from it but uses the
expectation instead (`expectedShields`), so determinization cannot leak into
decisions. Tests check that two states with the same view give identical
determinizations and evaluations.

## Candidate actions

`legalActions` lists every split count and every combination of field-attack
counts, which explodes with big stacks. `candidates(state)` lists what is worth
considering, each checked with `validateAction`:

- moves of the whole stack, all but one knight, or a single knight;
- field attacks per group of adjacent stacks that can win: all-in, and the
  cheapest win (defenders + 1, biggest stacks first);
- castle attacks moving one, half or all knights in;
- the shield placement, and `endTurn`.

`candidates(state, { allCounts: true })` adds every move and castle-attack count
(the random bot uses this).

## Evaluation

`evaluate(state, perspective)` is the player's value minus a blend of the
opponents' mean and best (`leader`). A player's value (`playerValues`):

- **castles**: 10 per sword held, minus half of that for every castle an enemy
  can take next turn: knights that can gather on an entrance with 1 MP to spare
  (a 0/1 knapsack over stacks by distance) reaching twice the garrison plus
  shield (own shield known, others' expected);
- **knights**: 1 per knight on the board, minus 0.7 per knight in a path stack an
  enemy can outnumber next turn;
- **potential**: for every castle the player does not hold, how soon they can
  take it: the nearest stacks are gathered until they reach the knights needed
  (2 × swords, or 2 × garrison + shield), and the farthest one needed sets a
  `0.85 ** steps` discount; short of the force it scales with
  `(force / needed)²`. An entrance held by someone else must be fought through
  first, which raises the force needed: this is what makes blocking an
  entrance worth something. Targets are summed best first with weights 1, ½,
  ¼, … (`focus`), times 6 per sword.

Distances are static walking distances (`distances(ctx)`, built once per
board); a finished game scores ±1000.

## Turn planning (medium)

`planTurns` is a beam search over a turn: from the position after the roll it
expands every candidate, evaluates each resulting position, keeps the best 8 at
each depth and continues while MP last. Ending the turn is possible after every
step, so the best position seen anywhere is the plan; it can be one action or
four (e.g. move, attack, attack, shield). Conquests are followed straight away
by the shield decision (`wantsShield`: always on 2–3 sword castles, on 1-sword
castles while more than 3 shields are left or the game is nearly over). An
attack on a castle whose shield is face down is a gamble: it is scored as the
expectation over the shield's possible values and ends the plan; the bot plans
again once the shield is revealed. The bot plays the plan one action at a time
and keeps it as long as the position is the one it expects (`PlanFollower`).

## Monte-Carlo search (hard)

`searchTurn` takes the heuristic's best 8 plans for the turn and plays each
out in sampled
worlds: a determinization of the hidden shields with fresh dice, the plan
itself (a gamble resolves against the sampled shield), then two rounds of
turns (the opponents', the bot's own next turn, the opponents' again) played
by the heuristic planner (beam 1). The position when the bot is to move
again is evaluated and squashed to a reward in
`[0, 1]`. All plans are played in the same worlds (common random numbers) and
narrowed down by sequential halving; the heuristic's own plan is never
dropped. The search stops at 150 simulations or after 3 s; time per decision
in the tournament below is with an iteration budget so results only depend on
seeds.

This is flat Monte-Carlo over turn plans (macro actions) rather than a full
ISMCTS tree: a turn has up to four actions and the opponents' replies are
whole turns too, so a tree over single actions spends its budget on move
orders. The determinization is the information-set part: every simulation
samples a world consistent with what the bot knows.

## Tournaments

```sh
pnpm tournament --lineup heuristic,random,random --games 100
pnpm tournament --lineup mcts,heuristic,heuristic --games 100 --seed 2001
```

Every lineup plays `--games` seeded games; seats rotate so each bot sits in
every seat equally often. Games run on worker threads (`--workers`, default:
all cores). A spec is `random`, `heuristic`, `mcts`, a level (`easy`, `medium`,
`hard`) or a bot with options: `heuristic:beam=4`, `mcts:iterations=100+rounds=2` (options joined by `+`),
`heuristic:w.potential=5` (an evaluation weight). The report gives wins (ties
split), mean points, thinking time per decision and game lengths.

### Results

3-player games on the Hrady board, seats rotated, `--max-turns 1000`. A
bot without skill wins 33.3%. Thinking time is the mean over all decisions,
rolls and steps of a plan already made included, on one core of a 4-core
cloud container.

| Lineup (100 games each)        | Seeds     | Wins (ties split) | Win rate            | Mean points      | ms / decision | Game length (turns)              |
| ------------------------------ | --------- | ----------------- | ------------------- | ---------------- | ------------- | -------------------------------- |
| heuristic vs random vs random  | 1–100     | 100 / 0 / 0       | 100% / 0% / 0%      | 27.1 / 1.0 / 0.9 | 5.6 / 0 / 0   | mean 293, median 282, 151–515    |
| mcts vs heuristic vs heuristic | 2001–2100 | 48.5 / 27 / 24.5  | 48.5% / 27% / 24.5% | 11.5 / 9.0 / 8.4 | 482 / 3 / 3   | mean 155, median 138.5, 69–1001¹ |

¹ One game hit the turn cap and was scored as it stood.

So the heuristic bot always beats random players, and the hard bot wins
about half of its games against two heuristic bots, almost twice as often as
either of them (100 games: 48.5 ± 5%, about three standard errors above 33.3%).

How the hard bot got there (hard bot's win rate against two heuristic bots;
60 games give about ± 6%, 100 games ± 5%):

| Variant                                                  | Games | Win rate |
| -------------------------------------------------------- | ----- | -------- |
| 60 simulations, one round                                | 36    | 40.3%    |
| 150 simulations, one round                               | 60    | 48.3%    |
| 150 simulations, one round, plans must differ by 2       | 100   | 31.0%    |
| 150 simulations, one round (heuristic's plan kept)       | 60    | 43.3%    |
| same, another plan must beat it by 0.01 to replace it    | 60    | 35.8%    |
| 300 simulations, one round                               | 60    | 40.8%    |
| **150 simulations, two rounds** (the default)            | 60    | 53.3%    |
| **150 simulations, two rounds**, seeds 2001–2100 (above) | 100   | 48.5%    |

With one simulated round (only the opponents' replies) the edge over the
heuristic was small and noisy (31–48%). Simulating the bot's own next turn and
the replies to it as well made it consistent; more simulations per turn did
not help as much as the longer horizon.

## Design decisions

Taken where the plan left room; listed here so they can be revisited.

1. **Easy is the random bot**, as the plan maps the three bots to the three
   levels. It hardly ever wins; a noisy heuristic bot would make a more
   interesting easy opponent.
2. **Public history.** Bots get the shields removed from the game
   (`removed`), which every player has seen revealed. Nothing else from the
   past is used, e.g. which castles were already attacked.
3. **Hard is flat Monte-Carlo over whole-turn plans** with determinization,
   not a full ISMCTS tree over single actions (see above). Simulated
   opponents play the heuristic with beam 1 and know only public shield
   information about the bot's castles.
4. **Shields** are placed by a fixed rule (`wantsShield`) in every bot rather
   than searched.
5. **Candidate counts** are limited (whole/all-but-one/one for moves,
   one/half/all into a castle, all-in or minimal field attacks); the random
   bot alone uses every move and castle-attack count.
6. **Time budget.** The hard bot stops at 150 simulations or 3 s per turn
   plan; in the debug client it is therefore not reproducible from seeds,
   while tournaments use the iteration budget only.
7. **Tournament scoring.** Shared wins are split; games reaching the turn cap
   are scored as they stand.

## Tests

`test/` covers the determinization (no hidden information leaks, sampling from
what is possible), the candidate generator (legal, few even with huge stacks),
each evaluation term, the planner on small fixture-board positions, and short
bot games. The tournament is not part of `pnpm test`; one quick game checks
that the heuristic bot beats two random bots.
