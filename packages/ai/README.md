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

`searchTurn` takes the heuristic's best plans for the turn (8, whose end
positions differ by at least two knights) and plays each out in sampled
worlds: a determinization of the hidden shields with fresh dice, the plan
itself (a gamble resolves against the sampled shield), then one round of
every opponent's turn played by the heuristic planner (beam 1). The position
when the bot is to move again is evaluated and squashed to a reward in
`[0, 1]`. All plans are played in the same worlds (common random numbers) and
narrowed down by sequential halving. The search stops at an iteration budget
or a time budget (1.5 s per turn plan at the Hard level); time per decision
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
pnpm tournament --lineup mcts:iterations=150,heuristic,heuristic --games 100 --seed 1001
```

Every lineup plays `--games` seeded games; seats rotate so each bot sits in
every seat equally often. Games run on worker threads (`--workers`, default:
all cores). A spec is `random`, `heuristic`, `mcts`, a level (`easy`, `medium`,
`hard`) or a bot with options: `heuristic:beam=4`, `mcts:iterations=100+rounds=2` (options joined by `+`),
`heuristic:w.potential=5` (an evaluation weight). The report gives wins (ties
split), mean points, thinking time per decision and game lengths.

### Results

_Tournament numbers follow once the tuning runs are done._

## Tests

`test/` covers the determinization (no hidden information leaks, sampling from
what is possible), the candidate generator (legal, few even with huge stacks),
each evaluation term, the planner on small fixture-board positions, and short
bot games. The tournament is not part of `pnpm test`; one quick game checks
that the heuristic bot beats two random bots.
