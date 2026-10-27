# @hrady/server

Online play: a Cloudflare Worker and one `GameRoom` Durable Object per room,
on the free plan (SQLite-backed Durable Objects, WebSocket Hibernation API,
alarms, no polling).

```sh
pnpm dev:server                          # wrangler dev on http://localhost:8787
pnpm --filter @hrady/server deploy       # after `npx wrangler login`
```

| Route                  | What                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `POST /api/rooms`      | `{ name, players }` → `201 { code, token }`; the creator holds seat 0   |
| `GET /api/rooms/:code` | the room's public `RoomInfo` (lobby, seats, members), or 404            |
| `GET /ws/:code`        | WebSocket upgrade; messages are JSON text frames, see `@hrady/protocol` |
| `OPTIONS *`            | CORS preflight                                                          |

Codes are 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (case-insensitive).
`ALLOWED_ORIGINS` (in `wrangler.toml`) is `*` or a comma-separated list of
origins that may call the API and open sockets; the web app is served from
GitHub Pages, so it is cross-origin. Requests from other origins get 403.

## Messages

The message types live in [`packages/protocol`](../../packages/protocol/src/messages.ts),
shared with the client; the server parses every frame with
`parseClientMessage` (shape, sizes, rebuilt actions with only the fields the
engine reads) and the engine's `validateAction` decides legality.

1. Every socket starts with `hello { name, token? }`. A known token gives the
   member (and their seat) back; otherwise a new member is created and the
   `welcome` carries their token, which the client keeps in `localStorage`.
   The welcome includes the room and, in a game, the member's view and the
   whole public log, so a refresh or a reconnect simply starts over from it.
2. Lobby: `sit`, `stand`, and for the host `setSeat` (open or Easy/Medium/Hard
   bot), `setOptions` (players 3–5, turn timer off/1/2/5 min) and `start`.
   Joiners take the first open seat; later joiners and anyone joining a
   running game watch.
3. Game: `act { action, at }` where `at` is the number of actions the client
   has seen (a stale `at` is answered with `error { code: 'stale' }`), `undo
{ to, at }`, `back` (stop the bot playing for me) and `leave`.
4. Every applied action goes to every socket as `action { at, entry, view }`:
   the action, its events (which never carry hidden values) and the
   recipient's own `viewFor` view; spectators get `viewFor(state, null)`.
   Room changes go out as `room`, the AI host gets `duty`.

The seed and the RNG state never leave the server, and no message carries
another player's face-down shield value. Keep-alive `ping` frames are
answered with `pong` by the runtime (`setWebSocketAutoResponse`) without
waking the object.

## Room logic

`src/room.ts` holds all decisions as pure functions over a `Room` value:
`receive(room, member, message, ctx)`, `disconnect`, `tick` (the alarm),
`nextAlarm` and `reconcile`. Each returns the new room, the messages to send
(per member, or to the socket that asked) and changes to the stored log.
`src/index.ts` (`GameRoom`) only does I/O: storage, sockets, alarms.

**Storage.** The `room` value (lobby, members with their tokens, the current
`GameState`, undo floor, removed shields, timers) and one `log:NNNNNN` value
per action (`{ action, events, auto? }`). The game is `(config, seed,
actions)`: replaying the log from the stored seed gives the stored state
(tested). One action costs two row writes.

**AI seats** run in a browser: the room's host gets `duty { seat, level, at,
obs }` whenever a bot seat is to move and answers with `act`. `obs` is the
seat's `viewFor` view plus the shield values removed so far (public), the
same `Observation` the local bots get. The host is handed over to the first
connected seated human when it disconnects, and again when it does not answer
within 45 s.

**Turn timer.** If the player to move does nothing for the room's turn time
(default 2 min, can be off), or is disconnected for 30 s on their turn (also
with the timer off), they are marked away and the AI host plays their seat
with the medium bot until they come back: reconnecting, acting or `back`.
Such a bot gets the seat's view **without its own face-down shield values**
(they are treated as unknown), so a human's hidden shields never reach
another player's browser.

**Undo.** The player to move may take back their own plain moves since the
last roll, battle, shield or bot action (`undo { to }`); the server rebuilds
the state from the undo floor and sends everyone `undone { length, view }`.

**Expiry** (alarm): a lobby nobody is connected to goes after 10 minutes, a
running game after 30 (time to come back), a finished game 30 minutes after
its end (5 once everyone left), and any room after 6 hours without a message.
The object then closes its sockets and deletes its storage and alarm.

## Design decisions

- **Bots run in the host's browser**, as decided in the plan: Worker CPU on
  the free plan is far too short for the medium and hard bots. A consequence
  is that the AI host's browser receives the bot seats' own views, including
  the bots' face-down shield values; a determined host could read them.
  Human seats never leak this way (see the turn timer).
- **The host is also the lobby admin.** If the creator leaves, the next
  connected member takes over; the creator does not get the role back.
- **A seated player who leaves a running game** only disconnects: a bot plays
  for them and the invite link brings them back. Leaving the lobby or a game
  one watches forgets the member.
- **Timer takeover uses the medium bot**, whatever the bot seats are set to.
- **One snapshot per connection.** The welcome sends the whole log (about
  100–150 bytes per action), so reconnecting late in a long game sends a few
  hundred kB once; every other message is a single action and one view.

## Tests

`test/room.test.ts` drives the room functions through `test/sim.ts`, a fake
`GameRoom` with a clock, sockets and browsers whose humans and AI host play
with the real bots; every message any client gets is checked for the seed,
the RNG and shield values it may not see. It covers the lobby, a full 4-seat
game with refreshes and a spectator, stale and foreign actions, reconnects,
host hand-off and duty time-out, idle and disconnect takeover, undo and
expiry. `test/worker.test.ts` starts the Worker in workerd (Miniflare via
`wrangler`'s `unstable_dev`) and plays a lobby, a few turns and a reconnect
over real WebSockets. `apps/web/scripts/online-e2e.mjs` plays a whole game in
several browsers against `wrangler dev`.
