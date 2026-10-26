# @hrady/web

The browser client. `index.html` is the three.js game; `debug.html` is the 2D
debug client from Stage 3 (also reachable as `index.html?debug` and from the
⚙ menu).

```sh
pnpm dev:web   # http://localhost:5173/ (3D), http://localhost:5173/debug.html (2D)
```

## 3D client

A local game for 3–5 players, each seat Human or an Easy, Medium or Hard bot,
on an original low-poly board built from the graph in `@hrady/board`. The
board photo is never used or shipped by the 3D client.

- **New game**: players, who plays each seat and an optional seed. The game
  and the settings are kept in `localStorage` (`hrady-game`,
  `hrady-settings`) and resumed on the next visit; the debug client keeps its
  own game.
- **Playing**: _Roll_ (<kbd>R</kbd>), then click one of your stacks (white
  ring) to select it. The count defaults to the whole stack; change it in the
  panel (−/+, _1_, _All_, or <kbd>↑</kbd>/<kbd>↓</kbd>). Click a green node
  to move, an orange castle to attack it (the count moves in on a win) or a
  red enemy marker to start a field attack. Highlights come from
  `legalActions`, through the same `selection.ts` as the debug client.
- **Field attacks** from several directions: once an attack is started, every
  node that may contribute gets a blue ring; click one to add it with all it
  can send (again to remove it), adjust the counts in the panel, then click
  the target or _Attack_ (<kbd>Enter</kbd>). The panel shows the engine's
  reason while the attack is not legal.
- **Shields**: after a conquest the panel offers _Place a shield_
  (<kbd>S</kbd>); any other action declines it.
- **Undo** (<kbd>Z</kbd>) takes back the last move, _Undo turn_ every move
  since the roll, the last battle or shield.
- **Bots** run in the Web Worker shared with the debug client and only see
  `viewFor` their seat plus the removed shields. Each action waits for the
  animations and the delay set under ⚙ (Slow/Normal/Fast); the hard bot
  thinks while the previous animation plays.
- **Hotseat**: the board is shown through the eyes of the player to move if
  they are human, otherwise the next human in turn order (`seats.ts`). With
  _Pass screen_ on and two or more humans, a curtain covers the screen
  whenever that viewer changes. Your own face-down shields show their value
  in brackets on the board and in the players table.
- **Camera**: drag (one finger) pans, right-drag (two fingers) rotates, wheel
  (pinch) zooms. The target stays over the board and the camera above it.
  Presets: _Board_ (<kbd>1</kbd>, whole board from above, turned to fit the
  screen), _Table_ (<kbd>2</kbd>, seen from the bottom edge), _Zoom_
  (<kbd>3</kbd>, the selection or your knights). <kbd>L</kbd> toggles castle
  names.
- **Layout**: a side panel on desktop, a bottom sheet under 760 px; the 3D
  view takes the rest of the window.

### What is on the board

- **Terrain** (`terrain.ts`): value-noise hills, flattened around every node
  and connection so pieces stand level. Faceted vertex colours by height and
  slope.
- **The Rhine** (`layout.ts`, `RHINE`): the graph does not describe the river,
  so it is an original centreline with a width, in the graph's normalised
  coordinates, running down the middle and widening at the bottom. The bed
  dips under a water plane; any node in the river gets an islet, so the river
  can never swallow a marker or castle whatever the graph looks like.
- **Path markers** are gold coins, **connections** white dots, and each
  castle **entrance** a white arrowhead on its marker pointing at the castle
  (as printed on the board). **Start areas** are scrolls with the die number
  and that many little shields.
- **Castles** face their entrance(s): rock base, open courtyard where the
  garrison stands, keep, one corner tower and one planted sword per sword of
  value, and a banner in the owner's colour (white while neutral). The name
  label carries the swords too.
- **Knights** are composed from 1, 2 and 5 figures (`figures.ts`: as many
  fives as fit, then twos, then ones) with a count badge; colours share a
  start area side by side.
- **Shields** stand beside their castle in the owner's colour: "?" while face
  down, "(n)" for your own face-down shield, a white face with the value once
  revealed.

### Animations

`steps.ts` turns the events of each action into steps (roll, place, travel
with or without a battle, siege, enter, shield, …) and `countsAfter` gives
the knights the board shows after each step, so a moving group can leave its
node, tween along an arc and arrive (tested over whole games to end on the
engine's state). `animator.ts` plays the steps one action at a time: a 3D die
in the panel tumbles onto the rolled face (`dice.ts`), groups hop between
nodes, field battles and conquests flash in the winner's colour, a siege
shows the revealed shield and the outcome, a lost siege flashes red on the
attackers' marker, shields drop onto their castle. The panel and the log
follow the animation. Clicking or pressing <kbd>Space</kbd> finishes the
running animations; ⚙ _Animations_ makes them faster or turns them off.

### Design decisions

- **Board proportions.** The graph is laid out 1.35× wider than the photo's
  aspect ratio (`WIDEN` in `layout.ts`), giving the river and the paths more
  room, inside a margin (`MARGIN`) so pieces and paths near the edge stay on
  the board. Only the 3D layout changes; the graph and the rules don't.
- **River course.** The graph has no river, so `RHINE` is a hand-made
  centreline (normalised coordinates, independent of node ids). Nodes that
  fall into it become islets; connections over water are dotted on the
  water surface.
- **Figures** are always shown as the fewest figures (fives, then twos, then
  ones), with a count badge; the rulebook's per-colour figure counts are
  ignored, like the knight supply.
- **Shield token visibility** follows `viewFor`: the viewer's own face-down
  values show as "(n)", everyone else's as "?".
- **Seats are fixed per game** in the 3D client (chosen in _New game_); the
  debug client still allows switching them mid-game.
- **Pass screen** also covers the very first turn when two or more humans
  play, so the first player confirms they are at the screen.
- **Undo** is only offered on a human's turn, back to the roll or the last
  battle or shield (as in the debug client); bot moves are never undone.
- **Mouse** follows map conventions (left-drag pans, right-drag rotates)
  rather than three.js's default orbit-on-left-drag, since panning is the
  common action on a board.

### Modules

| Module                                         | What                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `src/main.ts`                                  | the 3D client: game flow, bots, HUD wiring, input            |
| `src/game/layout.ts`                           | world layout from the graph: nodes, dots, entrances, river   |
| `src/game/terrain.ts`                          | height field and ground colours                              |
| `src/game/figures.ts`                          | 1/2/5 figure composition and placement                       |
| `src/game/steps.ts`                            | animation steps from engine events                           |
| `src/game/dice.ts`                             | die faces and resting orientation                            |
| `src/game/saved.ts`                            | save/resume and settings in `localStorage`                   |
| `src/game/scene.ts`, `models.ts`, `camera.ts`  | three.js scene, low-poly models, camera rig and presets      |
| `src/game/animator.ts`, `dieView.ts`, `hud.ts` | animation player, die canvas, HUD DOM helpers                |
| `src/shared/`                                  | shared with the debug client: session, selection, seats, log |
|                                                | text, highlight marks, the bot worker and its client         |

The pure modules have unit tests in `test/`. In dev builds `window.hrady`
exposes a few hooks (node screen positions, the session, the legal targets)
for browser tests.

## Debug client

A hotseat game for 3–5 players on an SVG drawing of the board graph, driving
the real engine. It exists to check the rules and the traced graph.

- **Playing.** Click one of your stacks (white ring) to select it; the count
  defaults to the whole stack and can be changed in the panel (or with
  <kbd>↑</kbd>/<kbd>↓</kbd>). Then click a green node to move, an orange castle
  to attack it (the count is how many knights move in on a win), or a red
  enemy marker to start a field attack. Highlights come from `legalActions`.
- **Field attacks** from several directions: once an attack is started, every
  node that may contribute gets a dashed blue ring. Click one to add it with
  all it can send (again to remove it) and adjust the counts in the panel.
  Attack or click the target to confirm; the panel shows the engine's reason
  while the attack is not legal. Clicking an enemy marker with nothing
  selected starts an empty attack.
- **Shields** are offered after a conquest (<kbd>S</kbd>); any other action
  declines. The board is rendered through `viewFor(state, current player)`,
  so only the current player's face-down shields show a value. With _Pass
  screen_ on, the board is covered when the turn passes.
- **Undo** (<kbd>Z</kbd>) takes back the last move, _Undo turn_ every move
  since the last roll, battle or shield. Both replay the log without them.
- **Export / Import** a game as `{ config, seed, actions }` JSON. **Replay**
  steps through it from its seed (<kbd>←</kbd>/<kbd>→</kbd>, or click a log
  line), seen as a spectator or any player; _Continue from here_ drops the
  later actions.
- **Bots.** Each seat in the _Seats_ panel is Human or an Easy, Medium or
  Hard bot (`@hrady/ai`: random, heuristic and Monte-Carlo). Bots move by
  themselves after the delay chosen under _Bots_ (Fast/Normal/Slow), or one
  action at a time with _Step_ (<kbd>N</kbd>). They run in a Web Worker
  (`shared/bot.worker.ts`) so the page stays responsive while the hard bot
  thinks (about 1.5 s per turn plan), and each bot only gets `viewFor` its
  seat plus the shields removed so far (public, from the log). Clicks and
  keys are ignored on a bot's turn; seats can be switched at any time, also
  mid-game.
- **Whose view.** The board shows the player to move if they are human,
  otherwise the next human in turn order, so the bots' moves are watched
  from that side; with only bots it is a spectator view. _Pass screen_
  covers the board only when that viewer changes between two humans.
- The current game and the seat choices are kept in `localStorage` across
  reloads.
- **Photo** (dev server only) draws `docs/board/board-full.jpg` under the
  graph. The import sits behind `import.meta.env.DEV`, so production builds
  never contain the photo.

Keys: <kbd>R</kbd> roll, <kbd>E</kbd> end turn, <kbd>Enter</kbd> confirm an
attack, <kbd>Esc</kbd> cancel, <kbd>N</kbd> next bot action.

`src/debug/main.ts` and `board.ts` are the DOM/SVG layer; the state lives in
the tested modules in `src/shared/`.
