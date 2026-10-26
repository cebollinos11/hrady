# @hrady/engine

The Hrady rules as a pure, deterministic TypeScript library: no DOM, no I/O, a
seeded PRNG and plain-JSON state. A game is fully described by
`(config, seed, actions[])`.

```ts
import { apply, initialState, legalActions, viewFor } from '@hrady/engine';

let state = initialState({ players: 3 }, seed); // Hrady board by default
const actions = legalActions(state, state.current); // [{ type: 'roll', player: 0 }]
const { state: next, events } = apply(state, actions[0]);
viewFor(next, 1); // what player 1 may see
```

| Function                        | What                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `initialState(config, seed)`    | New game. `config`: `players` (3–5), optional `firstPlayer`, `board` (`BoardData`) and `rules`.                  |
| `legalActions(state, player)`   | Every legal action in a stable order; `[]` when it is not the player's turn.                                     |
| `validateAction(state, action)` | Why an action is illegal, or `null`. Safe on untrusted input.                                                    |
| `apply(state, action)`          | `{ state, events }`. Never mutates its input; throws `IllegalActionError`.                                       |
| `viewFor(state, player)`        | Redacted view: no RNG state, other players' face-down shields have `value: null`. `null` gives a spectator view. |
| `isTerminal(state)`, `score()`  | Game over? Points per player, knights on the board (tiebreak) and the winners.                                   |
| `replay(config, seed, actions)` | Rebuilds a game from its log.                                                                                    |

## Turn and actions

Every action carries the acting `player`.

1. `roll` — the only legal action at the start of a turn. Draws the die from
   the seeded RNG, places a knight on that start area (unless the player
   already has one there) and grants 3 MP.
2. Any number of these, while MP last:
   - `move { from, to, count }` — 1 MP; moves `count` knights one step onto an
     empty or own path marker, or into an own castle.
   - `attackField { target, contributions: [{ from, count }] }` — knights from
     one or more adjacent nodes step onto an enemy-held marker; 1 MP per
     contributing node. Must outnumber the defenders.
   - `attackCastle { castle, from, count }` — 1 MP, from an entrance marker.
     All knights on `from` count; on a win `count` of them move in.
   - `placeShield { castle }` — only directly after conquering `castle`.
3. `endTurn` — always legal in the move phase, MP left or not.

Events (`rolled`, `knightPlaced`, `moved`, `fieldBattle`, `castleAttacked`,
`castleConquered`, `shieldPlaced`, `turnEnded`, `gameOver`, …) never carry
hidden values, so they can be broadcast to every player.

## Rule interpretations

Decisions taken where `docs/rules.md` and `docs/PLAN.md` §5 leave room. Change
them here and in the tests together.

1. **Roll is an action, placement is automatic.** The roll is the only legal
   action at the start of a turn, so clients can animate it; a server or bot
   can apply it straight away. When placement is skipped the player still gets
   3 MP.
2. **Field attacks are one step from adjacent nodes.** Each contribution moves
   from a node adjacent to the target (path marker, start area or own castle)
   and costs 1 MP. Knights further away first `move` closer; that MP comes out
   of the same 3-MP budget. All contributing knights move onto the won marker.
3. **Enemy castle attacks need twice the visible defence.** An attack is
   legal with at least 2 × (garrison + shield value if face up, else 0). With a
   face-down shield the attacker gambles; once the shield is face up a hopeless
   attack is illegal, like a field attack without a majority. Neutral castles
   need 2 × swords, so they can never be lost.
4. **Castle attack strength is the whole stack on the entrance marker.** The
   action names `from` because a castle can have several entrances. On a loss
   every knight on that marker returns to supply; knights elsewhere are safe.
   Knights on a start area or in a castle cannot attack a castle.
5. **Shields are optional and immediate.** After a conquest `placeShield` is
   offered; any other action declines it for good. The shield is drawn at
   random by the engine's RNG. The previous owner's shield on a conquered
   castle is removed from the game, not returned.
6. **Game end.** Only a conquest from neutral can end the game: when it leaves
   exactly one neutral castle, the game ends at once (remaining MP and the
   shield placement are forfeited) and that castle's swords go to the
   conqueror. Works for any castle count, not just 18.
7. **Tiebreak.** Knights on the board count start areas, path markers and
   castles. If points and knights are both tied, all tied players win.
8. **First player** is `config.firstPlayer` (default 0); a lobby can randomise
   it.

## Notes for later stages

- `legalActions` lists every split count and every combination of attack
  directions and counts. With large stacks next to an enemy marker this grows
  quickly (it is a product over the directions); the Stage 4 AI will want its
  own candidate generator and can use `validateAction` to check it.
- Undo within a turn is not built in; replaying the log up to the last
  irreversible action (any battle, roll or shield) gives the same result.

## Tests

`test/fixtures.ts` builds a small board so the rule tests do not depend on the
traced Hrady graph. The property tests play 2,000 seeded games on the Hrady
board with a random legal bot (biased towards progress so games end in a few
hundred turns), checking invariants after every action, plus 100 uniformly
random games on the fixture board. Set `HRADY_GAMES=200 pnpm test` for a
quicker local run.
