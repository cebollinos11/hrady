import { normaliseCode } from '@hrady/protocol';

/** What a request to the Worker asks for. */
export type Route =
  | { kind: 'home' }
  | { kind: 'preflight' }
  | { kind: 'create' }
  | { kind: 'info'; code: string }
  | { kind: 'socket'; code: string }
  | { kind: 'notFound' };

/**
 * `POST /api/rooms` creates a room, `GET /api/rooms/:code` describes it and
 * `/ws/:code` opens its WebSocket. Codes are case-insensitive.
 */
export function route(method: string, pathname: string): Route {
  if (method === 'OPTIONS') return { kind: 'preflight' };
  if (pathname === '/' && method === 'GET') return { kind: 'home' };
  if (/^\/api\/rooms\/?$/.test(pathname) && method === 'POST') return { kind: 'create' };
  const api = /^\/api\/rooms\/([^/]+)\/?$/.exec(pathname);
  if (api && method === 'GET') {
    const code = normaliseCode(api[1]!);
    if (code) return { kind: 'info', code };
  }
  const ws = /^\/ws\/([^/]+)\/?$/.exec(pathname);
  if (ws && method === 'GET') {
    const code = normaliseCode(ws[1]!);
    if (code) return { kind: 'socket', code };
  }
  return { kind: 'notFound' };
}

/**
 * The origin to echo in `Access-Control-Allow-Origin`, or `null` if the origin
 * is not allowed. `allowed` is a comma-separated list or `*` (any origin).
 */
export function allowOrigin(origin: string | null, allowed: string | undefined): string | null {
  const list = (allowed ?? '*')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (list.includes('*')) return '*';
  if (origin && list.includes(origin)) return origin;
  return null;
}
