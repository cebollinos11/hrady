# hrady

Reference material for the board game **Hrady** — also published as
**Highlanders** (Jumbo, 1993) and **Rheingold** — designed by Reinhard Herbert.
3–5 players fight over 18 castles along the Rhine.

This repo is a web app to play it against AI and human opponents; see
[`docs/PLAN.md`](docs/PLAN.md) for the architecture and stages.

## Development

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm lint          # ESLint + Prettier check
pnpm typecheck     # tsc in every package
pnpm test          # Vitest

pnpm dev:web         # three.js client (apps/web)
pnpm dev:server      # Worker + Durable Object via wrangler dev (apps/server)
pnpm dev:map-editor  # board tracing tool (tools/map-editor)
```

| Path               | What                                                     |
| ------------------ | -------------------------------------------------------- |
| `packages/board`   | board graph (`hrady.json`), types, loader, validation    |
| `packages/engine`  | pure, deterministic rules engine                         |
| `apps/web`         | Vite + three.js client                                   |
| `apps/server`      | Cloudflare Worker + SQLite-backed Durable Object         |
| `tools/map-editor` | click-to-trace editor over the board photo (not shipped) |

The server echoes WebSocket messages at `/ws/<room>` for now. Deploy with
`pnpm --filter @hrady/server deploy` after `npx wrangler login`.

## Contents

- [`docs/board/board-full.jpg`](docs/board/board-full.jpg) — full board, Czech _Hrady_ edition (main reference)
- [`docs/board/board-closeup.jpg`](docs/board/board-closeup.jpg) — close-up of the board
- [`docs/map.jpg`](docs/map.jpg) — older low-res photo of the board
- [`docs/KICKOFF_PROMPT.md`](docs/KICKOFF_PROMPT.md) — prompt to start development in a new session
- [`docs/rules.md`](docs/rules.md) — English rules (translation by Walt Mulder, 2007)
- [`docs/PLAN.md`](docs/PLAN.md) — staged implementation plan
- [`docs/Rheingold_rules.doc`](docs/Rheingold_rules.doc) — the original Word file of that translation

![Game board](docs/board/board-full.jpg)
