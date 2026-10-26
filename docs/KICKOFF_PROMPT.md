# Kickoff prompt

Paste the prompt below into a fresh Claude Code session on this repo to start
development. The original request and the owner's answers are kept at the
bottom for reference.

---

## Prompt

```text
You are developing a web app for the board game Hrady (aka Highlanders /
Rheingold) in this repo. Play is against AI and human opponents.

Read these first, they are the source of truth:
- docs/PLAN.md: architecture, stages, and confirmed rule/product decisions (§5)
- docs/rules.md: full rules
- docs/board/board-full.jpg: board reference (Czech edition with castle names)
- docs/board/board-closeup.jpg: close-up

Key constraints:
- TypeScript monorepo (pnpm workspaces): packages/engine (pure, deterministic,
  seeded RNG), packages/board, packages/ai, apps/web (Vite + plain three.js +
  DOM overlay, no React), apps/server (Cloudflare Worker + Durable Objects,
  free tier: SQLite-backed DOs, WebSocket Hibernation API), tools/map-editor.
- 3–5 players. English only. Room codes + display names, no accounts.
- Public site: never ship the board photo as a game texture. Build an original
  low-poly 3D board. The photo is only an underlay in the map editor.
- Online AI seats run in the host's browser (Web Worker); the DO is
  authoritative for validation and hides shield values from other players.
- Rules decisions: stacks can split; a field attack without a majority is
  illegal; owners may pass through their own castle; knight supply is
  unlimited; no variants at launch.

Task for this session: implement Stage 0 (scaffold) and Stage 1 (board
digitization) from docs/PLAN.md.

Stage 0:
- pnpm workspace, tsconfig base, Vitest, ESLint + Prettier, GitHub Actions CI
  (lint, typecheck, test).
- apps/web: Vite app that renders a basic three.js scene.
- apps/server: wrangler.toml + a Worker with a hello-world Durable Object
  (new_sqlite_classes migration) that echoes over a hibernating WebSocket.

Stage 1:
- tools/map-editor: a small Vite page showing board-full.jpg. You can add,
  move and delete nodes of type start (number 1–6), path, or castle (name +
  value 1–3), connect and disconnect edges, and import/export JSON.
- Create a first draft of packages/board/hrady.json by tracing
  board-full.jpg as carefully as you can. Coordinates are normalised 0..1 in
  image space. Include all 18 named castles with their sword values, the 6
  start scrolls (count the shields on each scroll for its number), every
  path marker, and every dotted-line connection.
- packages/board: types, a loader, and validation tests: exactly 6 starts
  numbered 1–6, 18 castles with unique names and values 1–3, a connected
  graph, no dangling edges, every castle adjacent to at least one path marker.
- List anything you couldn't determine from the image, for example the small
  white arrowheads printed next to some paths, unclear connections, or which
  marker gives access to a castle. I'll check the draft in the editor.

Work on the branch you were given. Commit in small logical steps, run lint,
typecheck and tests before each push, and push when done. Don't open a PR
unless I ask.
```

---

## Original request (2026-10-26)

> This repo is to implement a web app to play this board game against ai and
> human opponents. For online I want to use Cloudflare with durable objects
> (free tier). For visuals i want 3d using three Js.
> I want you to research the rules and come up with a staged implementation
> plan. Ask any questions

### Owner's answers to the planning questions

1. Higher-res board photos provided → `docs/board/`.
2. The site will be **public**.
3. Rules: split stacks **yes**; attack without a majority **no** (not
   allowed); pass through own castle **yes**; **unlimited** units; **no**
   house rules.
4. **3–5** players only.
5. Run AI on the **host browser**.
6. Just **room codes and names**.
7. **Plain** three.js.
8. **English** only.
9. **No variants** to start.
