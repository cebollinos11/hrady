/**
 * Where the game server runs. Set `VITE_SERVER_URL` at build time (e.g.
 * `https://hrady.<account>.workers.dev`); the dev server defaults to
 * `wrangler dev` on port 8787 of the same host.
 */
export function serverUrl(
  env: { VITE_SERVER_URL?: string; DEV: boolean },
  host: string,
): string | null {
  const url = env.VITE_SERVER_URL?.trim();
  if (url) return url.replace(/\/+$/, '');
  return env.DEV ? `http://${host}:8787` : null;
}

/** The WebSocket URL of a room on the server at `base` (http → ws, https → wss). */
export const socketUrl = (base: string, code: string) =>
  `${base.replace(/^http/, 'ws')}/ws/${encodeURIComponent(code)}`;
