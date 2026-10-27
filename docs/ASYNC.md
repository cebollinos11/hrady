# Asynchronous multiplayer — plan

Play with friends and computer players without keeping the app open: take
your turn, close the tab, and the next human gets their turn hours later.
A solo (local) game can run alongside.

This builds on Stage 6 (online rooms, see [`apps/server`](../apps/server/README.md)).
A game is still `(config, seed, actions)` in a `GameRoom` Durable Object; the
change is a second **room mode**, `async`, next to the existing `live` one.

## How a game flows

Seats in turn order: **Host, Guest, Bot, Bot**.

1. The host opens the app. The server hands the host's browser the duty for
   each bot seat (as in live play) and the bots play there.
2. The host plays their turn. The server stores it; the guest is next.
3. _(Later: the guest is notified — see [Notifications](#notifications-later).)_
   The guest opens the game, plays and ends their turn.
4. The next seats are bots, so the server waits. When the host opens the app
   again their browser plays the bots, and then it is the host's turn.

Nobody but the player to move ever acts during a human turn (every engine
action belongs to `state.current`), so a turn is something you finish in one
sitting.

## Rules of the mode

- **Seat order.** Going clockwise from the host, humans come first and all
  bots after them, i.e. every bot is followed by another bot or by the host.
  Otherwise a human would wait for a host who is not online. The lobby shows
  why _Start_ is disabled and the server checks it again on `start`. The host
  must hold a seat (they run the bots).
- **The bot host is fixed.** The creator keeps the host role for the whole
  game and is never replaced, so bot seats' hidden shield values only ever
  reach the host's browser (already the case in live play). The duty is not
  handed to anyone else when the host is away; it waits for them.
- **No takeover.** No turn timer, no disconnect grace, nobody is marked
  `away`: the server waits for the player to move.
- **Long-lived rooms.** A running game expires only after 14 days without a
  message (every move, or anyone opening it, resets it); an empty lobby after
  2 days; a finished game is kept 7 days. Live rooms keep their short limits.
- **Coming back.** A seated player who leaves only disconnects; their token
  (stored in the browser) brings them back to the same seat.

## Pieces

### `packages/protocol`

- `RoomMode = 'live' | 'async'`; `CreateRoomRequest.mode`.
- `RoomInfo.mode` and `RoomInfo.turn` (the seat to move, for "My games").
- `RoomStatus { room, me }` and `POST /api/rooms/:code/status { token }`:
  the room plus which member the token belongs to, so a client can list its
  games without opening a socket for each.
- `asyncSeatProblem(seats, host)`: the seat-order rule above, shared by the
  server (`start`) and the lobby (disabling _Start_).

### `apps/server`

- `Room.mode` (absent in rooms stored before this change ⇒ `live`).
- `room.ts`: no `deadline` in async; `expiry` per mode; the host is never
  replaced and the duty is never moved on in async; `start` checks
  `asyncSeatProblem`; `setOptions` ignores the turn timer in async.
- `index.ts` / `routes.ts`: `create` takes the mode, new `status` route.
- Tests: bot-order validation, a whole async game where the guest and host
  take turns while the host's browser is closed for long stretches (clock
  advanced by days), expiry, no takeover, host stays host, status route.

### `apps/web`

- _New room_ asks for **Live** or **Async**; async hides the turn timer and
  explains the seat rule; _Start_ is disabled with the reason.
- **My games** on the _Play online_ dialog: every room whose token this
  browser holds, with its state — _your turn_, _waiting for Bea_, _waiting
  for computer players (host must open the game)_, _finished_ — and an
  _Open_ button. Rooms the server no longer knows are dropped.
- Leaving an async game does not mention a bot taking over and the game is
  kept in My games, so a local single-player game can be played in between.

## Notifications (later)

Deliberately not part of this change. The server knows exactly when it
happens: an `action`/`turnEnded` that makes a **human** seat the one to move
while that member has no open socket. The hook point is the end of
`receive`/`act` in `room.ts`; the options to decide on are web push (needs a
PWA and VAPID keys), e-mail, or a Telegram/Discord webhook. The same event is
the "nudge the host" trigger when the next seat is a bot.

## Out of scope for now

- Skipping or auto-playing a human who has not moved for N hours (an
  optional per-game deadline).
- Bots running on the server.
- Accounts: identity stays the per-room token in `localStorage`.

## Steps

1. Protocol: types, parse, `asyncSeatProblem`, tests. ✅
2. Server: room mode, rules above, status route, tests. ✅
3. Web: create dialog, lobby, My games, wording. ✅
4. Docs: `apps/server/README.md`, `README.md`, `docs/PLAN.md`. ✅
5. Notifications, then the optional per-game deadline. ⏳
