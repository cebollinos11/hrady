# @hrady/protocol

The messages of online play, shared by the web client (`apps/web/src/online`)
and the game server (`apps/server`): TypeScript types for every message
(`messages.ts`) and the server-side validation of client input (`parse.ts`).

- `ClientMessage`: `hello`, `sit`, `stand`, `setSeat`, `setOptions`, `start`,
  `act`, `undo`, `back`, `leave`.
- `ServerMessage`: `welcome`, `room`, `game`, `action`, `undone`, `duty`,
  `error`, `closed`.
- `parseClientMessage(text)` checks a frame's shape and sizes and rebuilds
  actions with only the fields the engine reads (`parseAction`); it throws
  `ProtocolError` with the reason. Legality is the engine's `validateAction`.
- Room codes (`makeCode`, `normaliseCode`) and display names
  (`normaliseName`).

How the server uses them is described in
[`apps/server/README.md`](../../apps/server/README.md).
