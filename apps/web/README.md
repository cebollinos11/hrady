# @hrady/web

The browser client. `index.html` is the three.js scene (a placeholder until
Stage 5); `debug.html` is the 2D debug client from Stage 3.

```sh
pnpm dev:web   # then open http://localhost:5173/debug.html
```

## Debug client

A hotseat game for 3–5 players on an SVG drawing of the board graph, driving
the real engine. It exists to check the rules and the traced graph before the
3D client.

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
  (`bot.worker.ts`) so the page stays responsive while the hard bot thinks
  (up to 3 s per turn plan), and each bot only gets `viewFor` its seat plus
  the shields removed so far (public, from the log). Clicks and keys are
  ignored on a bot's turn; seats can be switched at any time, also mid-game.
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

The UI state is plain modules with unit tests in `test/`: `session.ts` (log,
undo, export/import), `selection.ts` (clicks, counts, attack contributions),
`seats.ts` (who plays which seat, whose view is shown, what a bot sees) and
`describe.ts` (log text). `main.ts` and `board.ts` are the DOM/SVG layer.
