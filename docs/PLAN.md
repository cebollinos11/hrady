# Hrady — Implementation Plan

Web app to play **Hrady / Highlanders / Rheingold** (Reinhard Herbert, 1993)
against AI and human opponents, with 3D visuals (three.js) and online play on
Cloudflare Workers + Durable Objects (free tier).

---

## 1. Rules summary (digital form)

Source: [`rules.md`](rules.md). Where the rulebook is silent or ambiguous,
the decisions in §5 apply.

**Components**
- Board graph: 6 start areas (numbered 1–6), ~100 path markers, 18 castles
  with value 1–3 (swords), connected by dotted lines.
- Per player: unlimited knights (shown as 1/2/5 figures) and 6 face-down
  defender shields valued 0, 0, 0, 1, 2, 3.
- 3–5 players, clockwise turn order.

**Turn**
1. **Roll & place** — roll d6, place 1 knight from supply on start area *N*.
   If you already have a knight there, your first move (1 MP) must take it
   off the start area; then the new knight is placed, leaving 2 MP. If every
   neighbour is held by an enemy, no knight is placed and you keep 3 MP.
   Supply is unlimited.
2. **Move** — 3 movement points (MP). 1 MP moves any stack (or any subset of
   a stack) one step along a connection. Splitting points
   across stacks is free.
3. **Field battle** — a path marker holds only one colour. Enemy stacks block
   movement. You may enter an enemy-held marker only if the knights you bring
   in **outnumber** the defenders by ≥1; knights can converge from several
   directions within the 3 MP. Defeated knights return to their owner's
   supply.
4. **Neutral castle** — from the adjacent path marker, with ≥ 2×(swords)
   knights on that marker and ≥1 MP left, spend 1 MP to conquer; at least one
   knight moves in. Owner *may* place one random face-down shield.
5. **Enemy castle** — same, but needs ≥ 2×(knights in castle + shield value).
   Shield is revealed on declaring the attack. Win: defenders to supply,
   shield removed from game, attacker occupies. Lose: **all** attacking
   knights on that marker go to supply, shield stays face-up. Costs 1 MP
   either way.
6. Start areas: multi-colour allowed, no battles, never re-entered.
7. A held castle must always contain ≥1 knight; extras move in/out freely.
   The owner may move through their own castle as a path node.

**End & scoring** — game ends immediately when the 17th castle is taken from
neutral (only one never-conquered castle left). Score = sum of swords of held
castles; the last neutral castle's value goes to the player who triggered the
end. Tiebreak: most knights on the board.

**Optional variants** (3 Kings, Quick 6, Pillaging, Attrition, My Shield My
Choice): **not at launch**; engine config keeps room for them.

---

## 2. Architecture

```
hrady/
├─ packages/
│  ├─ engine/      pure TS rules engine — no DOM, no I/O, deterministic
│  ├─ board/       board graph JSON + types + validation
│  ├─ ai/          bots (runs in Web Worker or Node)
│  └─ protocol/    online messages shared by client and server
├─ apps/
│  ├─ web/         Vite + TypeScript + three.js client
│  └─ server/      Cloudflare Worker + Durable Object (GameRoom)
└─ tools/
   └─ map-editor/  click-to-place nodes/edges over the board photo → JSON
```

- **Language/tooling**: TypeScript everywhere, pnpm workspaces, Vitest,
  ESLint/Prettier, GitHub Actions CI.
- **Engine API** (shared by client, server, AI):
  `initialState(config, seed)`, `legalActions(state, player)`,
  `apply(state, action) → {state, events}`, `viewFor(state, player)` (redacts
  hidden shield values + RNG), `isTerminal`, `score`. Seeded PRNG so games are
  replayable from `(seed, actions[])`.
- **Action model**: `Roll` → `Place` (auto) → sequence of
  `Move{from,to,count}` / `AttackField{target, contributions[]}` /
  `AttackCastle{castle, count}` / `PlaceShield` / `EndTurn`. Moves are
  undoable within a turn until something irreversible happens (battle,
  reveal).
- **Online**: one Durable Object per room, WebSocket **Hibernation API**,
  SQLite-backed storage (the only DO backend on the free plan). Server is
  authoritative: clients send intents, server validates with the engine and
  broadcasts per-player redacted views. Room code to join, reconnect token in
  localStorage, `alarm()` for turn timers and idle-room cleanup. Static
  client served via Workers static assets (or Pages).
- **3D**: three.js scene — board plane, river, low-poly castles at castle
  nodes, knight models in 3 sizes (1/2/5 auto-composed from stack count),
  shield tokens, 3D die. Raycast picking, highlighted legal targets, tweened
  moves, OrbitControls with clamped camera. HTML overlay for HUD/log.

---

## 3. Stages

Each stage ends playable/testable and is merged before the next starts.

### Stage 0 — Scaffold
Monorepo, TS config, Vitest, lint, CI, Vite app that renders an empty
three.js scene, Wrangler project that deploys a hello-world Worker + DO.
**Done when:** CI green; `wrangler deploy` works on the free account.

### Stage 1 — Board digitization
- Build `tools/map-editor`: overlays the board image; click to add start
  areas / path markers / castles (with value), drag to connect, export JSON.
- Produce `packages/board/hrady.json` (node id, type, x/y in board coords,
  castle value, start number, edges).
- Validation tests: 6 starts numbered 1–6, 18 castles, connected graph,
  every castle reachable, castle values match the board.
**Done when:** JSON is validated and visually checked over the photo.

### Stage 2 — Rules engine
State model, legal-action generation, reducer, redacted views, variant
flags, end-game/scoring. Unit tests for every rule in §1 plus the rulebook
examples (e.g. 2 knights + 3-shield castle needs 10 attackers), and a
property test: random legal games always terminate with consistent state.
**Done when:** thousands of random-bot games run without invariant
violations.

### Stage 3 — 2D debug client, local hotseat
Quick SVG view of the board graph (photo as an optional dev-only underlay) driving the real engine: hotseat for
3–5 humans, action log, replay from seed. Purpose: validate rules and the
graph before investing in 3D.
**Done when:** a full human game can be played end to end.

### Stage 4 — AI opponents
1. Random legal bot (testing baseline).
2. Heuristic bot: scores actions by castle value/threat, consolidation of
   stacks, blocking, safe castle garrisons; plans the 3 MP as a sequence.
3. Stronger bot: Monte-Carlo / ISMCTS with determinization of hidden
   shields, running in a Web Worker with a time budget.
Difficulty levels map to these. Bot-vs-bot tournament script to tune.
**Done when:** heuristic bot reliably beats random; hard bot beats
heuristic. *(Implemented in [`packages/ai`](../packages/ai/README.md): Easy =
random, Medium = heuristic planner, Hard = Monte-Carlo over turn plans;
tournament numbers and design decisions are in its README.)*

### Stage 5 — 3D client
Replace the debug view with three.js: board, castles, knights, shields,
die roll animation, selection/move UX (click stack → pick count → click
target), legal-move highlighting, camera presets, responsive layout, HUD
(turn, MP left, supply, scores), game log. Debug view stays behind a flag.
**Done when:** local games vs AI are fully playable in 3D on desktop and
mobile. *(Implemented in [`apps/web`](../apps/web/README.md): original
procedural board, 1/2/5 figures, animations from engine events, hotseat with
bots and save/resume in `localStorage`; the debug client is at `debug.html`.)*

### Stage 6 — Online multiplayer
Worker routes (`/api/rooms`, `/ws/:room`), `GameRoom` DO with hibernating
WebSockets, lobby (create/join by code, pick colour, add AI seats driven by
the host browser, server-authoritative turns, hidden-info redaction, reconnect,
spectators, AI-host hand-off, turn timer + AFK→bot takeover, room expiry via alarms.
Stay within free-tier limits (100k requests/day, small messages, no
polling).
**Done when:** 3–5 browsers play a full game with AI seats mixed in, survive
refreshes/disconnects. *(Implemented in [`apps/server`](../apps/server/README.md)
with the shared [`packages/protocol`](../packages/protocol/src/messages.ts) and
the _Online_ mode of [`apps/web`](../apps/web/README.md#online-play). Notes:
the room logic is pure functions (`room.ts`) under a thin Durable Object;
the game is stored as config, seed and an action log plus a state snapshot;
bots for AI seats and for players who are away run in the host's browser,
which is handed to another seated human when the host leaves; a bot playing
for an absent human never sees that human's hidden shields; the turn timer
(off/1/2/5 min, default 2) and a 30 s disconnect grace hand a seat to the
bot until its player is back; undo online covers the player's own moves
since the last irreversible action, checked by the server. Unit tests drive
the room logic with fake browsers and check every message for leaks, a
Miniflare test runs the Worker, and `apps/web/scripts/online-e2e.mjs` plays a
5-seat game in Playwright browsers against `wrangler dev`.)*

### Stage 6b — Asynchronous games
Rooms in `async` mode for turns days apart: no takeover, long-lived rooms, bots
play in the host's browser when the host opens the game (so they sit right
before the host in turn order), a "My games" list. Notifications are not
included yet. Plan and rules: [`ASYNC.md`](ASYNC.md).

### Stage 7 — Polish
Sounds, animations for battles/reveals, tutorial/rules overlay, i18n
accessibility (colour-blind-safe player colours + patterns),
end-game summary, save/resume local games, game replays.

#### 7a — Spawn, battle and reveal animations (implemented)

Scope: visuals only (no audio yet; the new steps expose named hooks such as
`spawn`, `clash`, `reveal`, `capture` so sounds can attach later). Everything
is planned from public engine events in `apps/web/src/game/steps.ts` and played
by `animator.ts`, so every viewer (including spectators) sees the same thing.
The existing speed setting and click-to-`hurry()` keep working: every new
effect must finish instantly when `ms = 0`.

**Spawn.** The die lands, then the new knight drops onto the start area with a
short landing puff in the player's colour (replaces the plain drop).

**Spawn onto your own knight.** The engine emits `spawnBlocked` on the roll;
the knight that must leave is moved by the player's first move, after which the
engine emits `knightPlaced` on that start area. Show this as a sequence rather
than the current "already here" text popup:
1. Die lands → the occupying knight pulses (outline/glow) and a translucent
   ghost knight appears above the start area.
2. Ghost stays while the player makes the forced first move (the HUD hint says
   the start area must be cleared first).
3. When `knightPlaced` arrives the ghost solidifies and drops in.
A new step kind `spawnPending` replaces `skip` for `spawnBlocked`;
`placementSkipped` (all neighbours held by enemies, no knight placed) keeps a
short "blocked" cue: the ghost fades out with a red tint instead of landing.
The ghost must be restored from the state on load/reconnect (pending when the
start area holds the player's knight during the move phase with placement
not yet done), not only from the event stream.

**Field battle (~1.2 s, "clash + casualties").**
1. Attackers walk in from every contributing marker (already supported).
2. Clash: a dust/spark burst at the target, a small camera shake (a few px,
   ~150 ms), figures lean towards each other.
3. Casualties: defenders fall/fade one by one (staggered ~80 ms), tinted in
   their colour; attackers settle onto the marker.
No new engine data needed: `fieldBattle` already has `defeated` and the
defender.

**Castle attack and shield reveal.**
1. Attackers lunge towards the castle (existing).
2. If the castle has a shield, it rises and flips in 3D to show its value
   (0–3), then holds for ~400 ms. The value is already public in the
   `castleAttacked` event, so no hidden information is leaked earlier than the
   rules allow.
3. Resolution: on a win the shield shatters and the flag/colour of the castle
   changes to the attacker; on a loss the shield stays face-up on the castle
   and the attackers fall (all knights on the marker go to supply).
4. Neutral castles (no shield) skip the flip and go straight to resolution.
The old text popup is removed; the numbers it showed (attackers vs
2×(garrison + shield)) can stay as a small label next to the flipped shield.

**Own shield placement.** A won castle's owner places a random face-down
shield: the tile drops face-down onto the castle (existing `dropShield`),
without showing the value to anyone else (only face-down in the redacted view).

**Implementation steps**
1. Extend `Step` (`spawnPending`, `clash`, `reveal`) and `planSteps`/
   `countsAfter`/`stepDuration`, with unit tests in `apps/web/test` for each
   event sequence (spawn blocked then placed; blocked-then-skipped; attack with
   and without shield; win and loss).
2. Add the scene primitives to `pixelScene.ts`/`figures.ts`: ghost knight,
   pulse, camera shake, staggered fade of figures, 3D shield flip + shatter.
3. Wire them in `animator.ts` (`hurrying` ⇒ zero-duration), and restore the
   spawn ghost from state on resume/reconnect.
4. Playwright check in `apps/web/scripts` that plays a scripted game with a
   blocked spawn, a field battle and a shielded castle attack and asserts the
   queue drains (no stuck animator) in normal, fast and hurry modes.
**Note:** the main board is a 2D pixel-art canvas (`PixelScene`), not three.js,
so the shield "3D flip" is a 2D flip: the shield sprite is squeezed to an edge
and widened again showing its face. Effects live in `pixelScene.ts`, the
sequencing in `animator.ts`, the planning in `steps.ts`
(`apps/web/test/steps.test.ts`, `animator.test.ts`).

**Done when:** each of the four situations above plays correctly in local and
online games, `hurry()` never leaves a ghost or half-faded figure behind, and
the animator tests pass.

---

## 4. Risks

- **Board graph accuracy** — trace from `board/board-full.jpg`; the owner
  verifies the result in the map editor overlay.
- **Artwork/IP** — the board photo is the publisher's art and the site is
  public, so the 3D board must be original (procedural/low-poly terrain,
  river, own castle models). Castle names from the Czech edition are fine.
- **AI host** — AI seats in online games run in the host's browser (Web
  Worker). Needs a host hand-off when the host leaves.

---

## 5. Decisions (confirmed with owner, 2026-10-26)

| Topic | Decision |
|---|---|
| Board reference | `board/board-full.jpg` (876×1200, Czech *Hrady* edition with castle names) and `board/board-closeup.jpg`. Old `map.jpg` is superseded. |
| Deployment | **Public.** Do not ship the board photo as a texture; build an original low-poly 3D board. Photo is only used by the map editor. |
| Splitting stacks | **Allowed** — any number of knights may be split off and moved. |
| Field attack without a majority | **Not allowed** (no "lose" outcome; the move is simply illegal). |
| Passing through own castle | **Allowed** — a held castle can be used as a path node by its owner (each step still costs 1 MP). Enemy/neutral castles block. |
| Knight supply | **Unlimited** — no 42-knight / figure-count cap; 1/2/5 figures are purely visual. |
| House rules | None. Rules as in `rules.md`. |
| Player count | **3–5 only.** |
| AI in online games | Runs in the **host's browser** (room creator); the DO only validates. If the host disconnects, hand AI duty to another connected human. |
| Accounts | **Room codes + display names** only. No login, ranking or history. |
| Front-end | **Plain three.js** + lightweight DOM/HTML overlay (no React). |
| Language | **English only.** |
| Variants | **None** at launch (keep engine config extensible). |
| Mobile | Not prioritised; keep layout usable but desktop first. |

### Remaining rule assumptions (default unless told otherwise)
- After winning a field battle the attackers occupy the marker and may keep
  moving with remaining MP.
- A failed enemy-castle attack loses **all** knights on the attacking marker.
- The 17th castle ever taken from neutral ends the game; its taker also
  scores the last neutral castle.
- A player who has used all 6 shields places none.
- The castle attack MP also moves the entering knight(s) in.
- Further engine interpretations (castle attack legality with a face-down
  shield, shield timing, tiebreak details, …) are listed in
  [`packages/engine/README.md`](../packages/engine/README.md#rule-interpretations).
- Board details to resolve in Stage 1: the small white arrowheads printed
  next to some paths (one-way? castle entry?) and which marker(s) give access
  to each castle.
