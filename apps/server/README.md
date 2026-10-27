# @hrady/server

Online play: a Cloudflare Worker and one `GameRoom` Durable Object per room,
on the free plan (SQLite-backed Durable Objects, WebSocket Hibernation API,
alarms, no polling).

```sh
pnpm dev:server                          # wrangler dev on http://localhost:8787
pnpm --filter @hrady/server run deploy       # after `npx wrangler login`
```

| Route                          | What                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- |
| `POST /api/rooms`              | `{ name, players }` → `201 { code, token }`; the creator holds seat 0   |
| `GET /api/rooms/:code`         | the room's public `RoomInfo` (lobby, seats, members), or 404            |
| `POST /api/rooms/:code/status` | `{ token }` → `{ room, me }`: the room and which member the token is    |
| `GET /ws/:code`                | WebSocket upgrade; messages are JSON text frames, see `@hrady/protocol` |
| `OPTIONS *`                    | CORS preflight                                                          |

Codes are 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (case-insensitive).
`ALLOWED_ORIGINS` (in `wrangler.toml`) is `*` or a comma-separated list of
origins that may call the API and open sockets; the web app is served from
GitHub Pages, so it is cross-origin. Requests from other origins get 403.

## Deploying on the Cloudflare free plan

Everything here fits the Workers Free plan: no card needed, and Durable
Objects on the free plan are SQLite-backed, which is what `GameRoom` uses.

1. **Account.** Sign up at <https://dash.cloudflare.com/sign-up> (free).
   Open _Workers & Pages_ once and pick your `workers.dev` subdomain
   (e.g. `ann` gives `https://hrady.ann.workers.dev`).
2. **Log in from this repo** (Node 22+, pnpm 10):
   ```sh
   pnpm install
   cd apps/server
   npx wrangler login        # opens the browser to authorise wrangler
   npx wrangler whoami       # shows the account it will deploy to
   ```
   On a machine without a browser, create an API token instead (_My
   Profile → API Tokens → Create Token → "Edit Cloudflare Workers"_
   template) and `export CLOUDFLARE_API_TOKEN=…`.
3. **Restrict origins (recommended).** In `wrangler.toml` set
   `ALLOWED_ORIGINS` to where the client runs, e.g.
   `"https://cebollinos11.github.io,http://localhost:5173"` (no path, no
   trailing slash). `*` allows any site to use your server.
4. **Deploy:**
   ```sh
   pnpm --filter @hrady/server run deploy
   ```
   Wrangler bundles the Worker, applies the Durable Object migrations
   (`v1`, then `v2`: `EchoRoom` → `GameRoom`) and prints the URL, e.g.
   `https://hrady.<subdomain>.workers.dev`. Check it:
   ```sh
   curl https://hrady.<subdomain>.workers.dev/          # "Hrady server is running."
   curl -X POST https://hrady.<subdomain>.workers.dev/api/rooms \
     -H 'Content-Type: application/json' -d '{"name":"Test","players":3}'
   ```
   (The test room expires after 10 minutes on its own.)
5. **Point the published client at it.** In the GitHub repository:
   _Settings → Secrets and variables → Actions → Variables → New repository
   variable_, name `HRADY_SERVER_URL`, value the Worker URL (no trailing
   slash). Then re-run the _Pages_ workflow (_Actions → Pages → Run
   workflow_) or push to `main`; the build passes it to the client as
   `VITE_SERVER_URL`. The _Online_ button then works on the GitHub Pages
   site. For a local build against it:
   `VITE_SERVER_URL=https://hrady.<subdomain>.workers.dev pnpm dev:web`.
6. **Watching it.** `npx wrangler tail` streams the Worker's logs; the
   dashboard (_Workers & Pages → hrady_) shows requests, errors and the
   Durable Object usage.

**Free-plan limits** (per day, reset at 00:00 UTC; see Cloudflare's pricing
pages for the current numbers): 100,000 Worker requests, Durable Object
requests and duration allowances, and for SQLite storage about 5 million
rows read, 100,000 rows written and 5 GB stored. A game costs one HTTP
request to create the room, one WebSocket per player (each message is a
Durable Object request; keep-alive pings are answered without waking it),
and about two row writes per action, so a typical game of 1,000–3,000
actions writes 2,000–6,000 rows: on the order of twenty full games a day
before the write limit. Over a limit, requests fail until the next day;
nothing is charged on the free plan.

**Updating** is the same `deploy` command. A schema change of the stored
`room` value needs care with rooms in progress; a new Durable Object class
needs a new `[[migrations]]` entry (`new_sqlite_classes`, never
`new_classes`, which the free plan rejects).

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

## Async rooms

`POST /api/rooms` takes `mode: 'live' | 'async'` (default `live`). An async room
is for turns hours or days apart (design: [`docs/ASYNC.md`](../../docs/ASYNC.md)):

- no turn timer, no disconnect grace, nobody is marked away: the server waits;
- the creator stays the host for good and the bot duty is never handed to
  anyone else or timed out: it waits until the host's browser connects;
- `start` requires the host to hold a seat and every bot to be followed by
  another bot or the host (`asyncSeatProblem` in `@hrady/protocol`), so a human
  never waits for a host who is away;
- expiry: 14 days without a message for a running game (never for "nobody
  connected"), 2 days for an empty lobby, 7 days after a game ends.

`POST /api/rooms/:code/status` lets a client list its games without opening a
socket: it sends a stored token and gets the `RoomInfo` (with `mode` and
`turn`, the seat to move) and its member id.

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
