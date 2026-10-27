# @hrady/web

The browser client. `index.html` is the pixel-art game; `debug.html` is the 2D
debug client from Stage 3 (also reachable as `index.html?debug` and from the
⚙ menu).

```sh
pnpm dev:web   # http://localhost:5173/ (game), http://localhost:5173/debug.html (2D)
```

## Game client

A local game for 3–5 players, each seat Human or an Easy, Medium or Hard bot,
on an original low-poly board built from the graph in `@hrady/board`. The
board photo is never used or shipped by the game client.

- **Top-down pixel-art board** in the style of the 16-bit adventure games,
  drawn by `PixelScene` (`pixelScene.ts`) behind the `BoardView` interface
  (`boardView.ts`). A `Look` (`look.ts`, `topLook.ts`) says how the world is
  projected and the ground and sprites (`pixel/`) are drawn. It draws into a
  small 2D canvas the browser scales up without smoothing: the ground is
  tiles drawn once, castles, knights and trees are sprites sorted back to
  front, text uses a 3×5 bitmap font. Drag pans, wheel or pinch zooms, and the
  Board / Table / Zoom buttons fit the whole board, step in, or frame the
  selection.
- **New game**: players, who plays each seat and an optional seed. The game
  and the settings are kept in `localStorage` (`hrady-game`,
  `hrady-settings`) and resumed on the next visit; the debug client keeps its
  own game.
- **Playing**: _Roll_ (<kbd>R</kbd>), then click one of your stacks (white
  ring) to select it. The count defaults to the whole stack; change it in the
  panel (−/+, _1_, _All_, or <kbd>↑</kbd>/<kbd>↓</kbd>). Every node the stack
  can walk to with the movement points left is ringed green, with the MP it
  takes when more than one; click it to walk there in one go (the stack stays
  selected while it can still move, again with all its knights). Castles it
  can attack, right away or after walking to an entrance, are ringed orange
  (the count moves in on a win). Enemy markers it can attack are ringed red:
  a neighbouring one starts a field attack, one further away that the stack
  can beat on its own is walked to and attacked in one click (the ring shows
  the MP it takes, the attack included). Paths are planned by
  `pathsFrom` in `selection.ts`, which checks every step with the engine; the
  debug client shares it.
- **Field attacks** from several directions: once an attack is started, every
  node that may contribute gets a blue ring; click one to add it with all it
  can send (again to remove it), adjust the counts in the panel, then click
  the target or _Attack_ (<kbd>Enter</kbd>). The panel shows the engine's
  reason while the attack is not legal.
- **Shields**: after a conquest the panel offers _Place a shield_
  (<kbd>S</kbd>); any other action declines it.
- **Undo** (<kbd>Z</kbd>) takes back the last move, or the whole walk if the
  last click walked several steps; _Undo turn_ every move since the roll, the
  last battle or shield.
- **Bots** run in the Web Worker shared with the debug client and only see
  `viewFor` their seat plus the removed shields. Each action waits for the
  animations and the delay set under ⚙ (Slow/Normal/Fast); the hard bot
  thinks while the previous animation plays.
- **Hotseat**: the board is shown through the eyes of the player to move if
  they are human, otherwise the next human in turn order (`seats.ts`). With
  _Pass screen_ on and two or more humans, a curtain covers the screen
  whenever that viewer changes. Your own face-down shields show their value
  in brackets on the board and in the players table.
- **What the others did**: since your last turn, every move of the other
  players is drawn as an arrow in their colour (field battles and castle
  attacks thicker, a failed siege stops short with a ✕); ⚙ _Last moves_
  (<kbd>T</kbd>) hides them. When your turn comes, a note at the bottom sums
  up the battles (`recent.ts`) and your stacks flash.
- **Log**: path markers are named after their castle ("gate of Kajetce" for
  an entrance, else "road by" the closest castle, `placeName`), walks are one
  line, and hovering a line rings its nodes on the board.
- **Camera**: drag (one finger) pans, wheel (pinch) zooms. Presets: _Board_
  (<kbd>1</kbd>, the whole board, fitted to the free part of the view) and
  _Table_ (<kbd>2</kbd>, closer in). _Zoom_ (<kbd>3</kbd>) looks at the selection, or fits
  all your stacks; pressing it again visits each stack, largest first.
  <kbd>L</kbd> toggles castle names.
- **Layout**: a side panel on desktop, a bottom sheet under 760 px; the board
  takes the rest of the window.

### Online play

_Online_ (top bar) opens the online dialog: a name, then _Create room_
(3–5 players) or _Join_ with a room code. An invite link is the page with
`?room=CODE`; opening it joins the room (asking for a name the first time).
The room stays in the address bar, so a refresh comes back to it.

- **Lobby**: the seats in their colours; anyone may _Sit here_ on an open
  seat or _Watch instead_. The host (the creator, or whoever took over) sets
  each free seat to Open or an Easy/Medium/Hard bot, the number of players,
  the turn timer, and starts the game once every seat is taken. People who
  join a running game watch it as spectators (`viewFor(state, null)`).
- **Playing** looks and works like a local game: the same board,
  animations, log, trails and selection UX, driven by the server. Clicks
  send intents (`act { action, at }`); the board changes when the server's
  `action` message comes back with the events (animated as usual) and this
  seat's new view. `online/mirror.ts` turns that view into a stand-in
  `GameState` (hidden values as 0, no RNG) so the local code for legal
  targets, selection and scoring runs unchanged; nothing hidden is in it.
- **Undo** online takes back your own moves since your last roll, battle or
  shield (or a move a bot made for you); the server checks it and everyone's
  board snaps back.
- **Bots**: the host's tab is the AI host. When a bot seat is to move, the
  server sends it the seat's observation (`duty`); the tab runs the bot in
  the same Web Worker as local games and sends its action after the
  animations and the ⚙ bot delay. If the host leaves, another seated player
  takes over within moments.
- **Turn timer**: the status line shows the time left (⏱) when a timer runs.
  When it runs out, or 30 s after a player on turn lost their connection, a
  medium bot plays for them; the panel then offers _I'm back_ (returning or
  playing a move also ends it).
- **Leaving**: _Leave room_ goes back to the local game, which is kept
  meanwhile. A seated player who leaves a running game keeps their seat
  (a bot plays) and can come back with the link; reconnect tokens are kept
  per room in `localStorage` (`hrady-online`).
- **Server URL**: `VITE_SERVER_URL` at build time; the dev server uses
  `http://<host>:8787` (`wrangler dev`) by default. The Pages build reads it
  from the repository variable `HRADY_SERVER_URL`.

`scripts/online-e2e.mjs` checks all of this in several Playwright browsers
against `pnpm dev:server` and `pnpm dev:web`: a 5-seat game with three humans
and two bots, a refresh, the host leaving (hand-off and bot takeover) and
coming back, and a late spectator, checking every WebSocket frame for hidden
shield values.

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
  value. Neutral castles have slate roofs; an owned castle's roofs, banner
  and a ring round its foot take the owner's colour, so ownership reads from
  the whole-board view. The name label ends in a gold tab with the value.
- **Knights** are composed from 1, 2 and 5 figures (`figures.ts`: as many
  fives as fit, then twos, then ones) with a count badge; colours share a
  start area side by side. Count badges and castle labels never get smaller
  than about 20 px on screen (`minPixels`), so every stack can be found from
  the whole-board view.
- **Shields** stand to the right of their castle on screen, in the owner's
  colour: "?" while face down, "(n)" for your own face-down shield, a
  parchment face with the value once revealed. They always face the camera,
  are drawn over the castle and its name, and are kept at least 40 px tall
  (`minPixels`, which also scales models), so they read at any zoom.

### Animations

`steps.ts` turns the events of each action into steps (roll, place, travel
with or without a battle, siege, enter, shield, …) and `countsAfter` gives
the knights the board shows after each step, so a moving group can leave its
node, tween along an arc and arrive (tested over whole games to end on the
engine's state). `animator.ts` plays the steps one action at a time: a die
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
  the board. Only the layout changes; the graph and the rules don't.
- **Paths behind the scrolls.** On the board the outer path passes just
  behind each start scroll. `clearStarts` (in `layout.ts`) pushes the two
  markers of any marker-to-marker connection that would run under a scroll
  away from it (outwards when it runs straight through), so the path clears
  the scroll by `START_CLEARANCE`. It works from the geometry only, without
  node ids.
- **River course.** The graph has no river, so `RHINE` is a hand-made
  centreline (normalised coordinates, independent of node ids). Nodes that
  fall into it become islets; connections over water are dotted on the
  water surface.
- **Figures** are always shown as the fewest figures (fives, then twos, then
  ones), with a count badge; the rulebook's per-colour figure counts are
  ignored, like the knight supply.
- **Shield token visibility** follows `viewFor`: the viewer's own face-down
  values show as "(n)", everyone else's as "?".
- **Seats are fixed per game** in the game client (chosen in _New game_, or in
  the online lobby); the debug client still allows switching them mid-game.
- **Online games reuse the local game flow**: a mirrored session from the
  server's views rather than a second client, so both modes share every
  rendering and selection path. _Pass screen_ does not apply online.
- **Pass screen** also covers the very first turn when two or more humans
  play, so the first player confirms they are at the screen.
- **Undo** is only offered on a human's turn, back to the roll or the last
  battle or shield (as in the debug client); bot moves are never undone.
- **Mouse** follows map conventions: left-drag pans, wheel zooms.

### Modules

| Module                                            | What                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `src/main.ts`                                     | the game client: game flow, bots, HUD wiring, input          |
| `src/game/layout.ts`                              | world layout from the graph: nodes, dots, entrances, river   |
| `src/game/terrain.ts`                             | height field and ground colours                              |
| `src/game/figures.ts`                             | 1/2/5 figure composition and placement                       |
| `src/game/steps.ts`                               | animation steps from engine events                           |
| `src/game/dice.ts`                                | die faces and resting orientation                            |
| `src/game/saved.ts`                               | save/resume and settings in `localStorage`                   |
| `src/game/pixelScene.ts`, `look.ts`, `topLook.ts` | pixel-art board renderer, camera rig and the top-down look   |
| `src/game/animator.ts`, `dieView.ts`, `hud.ts`    | animation player, die canvas, HUD DOM helpers                |
| `src/online/`                                     | online mode: connection, lobby, view mirror, tokens          |
| `src/shared/`                                     | shared with the debug client: session, selection, seats, log |
|                                                   | text, highlight marks, the bot worker and its client         |

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
  thinks (up to 3 s per turn plan), and each bot only gets `viewFor` its
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
