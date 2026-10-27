import type { Store } from '../game/saved';

/** `localStorage` key for the online name and the reconnect token of each room. */
export const ONLINE_KEY = 'hrady-online';

export interface OnlineStore {
  name: string;
  /** Reconnect token per room code. */
  tokens: Record<string, string>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Rooms remembered at most; the oldest are forgotten first. */
const MAX_ROOMS = 20;

export function loadOnline(store: Store): OnlineStore {
  let raw: unknown = null;
  try {
    raw = JSON.parse(store.getItem(ONLINE_KEY) ?? 'null');
  } catch {
    // Start afresh.
  }
  const o = isObject(raw) ? raw : {};
  const tokens: Record<string, string> = {};
  if (isObject(o.tokens))
    for (const [code, token] of Object.entries(o.tokens))
      if (typeof token === 'string') tokens[code] = token;
  return { name: typeof o.name === 'string' ? o.name : '', tokens };
}

export function saveOnline(store: Store, data: OnlineStore) {
  const codes = Object.keys(data.tokens);
  const tokens: Record<string, string> = {};
  for (const code of codes.slice(-MAX_ROOMS)) tokens[code] = data.tokens[code]!;
  try {
    store.setItem(ONLINE_KEY, JSON.stringify({ name: data.name, tokens }));
  } catch {
    // A full or blocked storage only costs the reconnect.
  }
}

/** Remembers the token of a room (moved to the end, so it is kept longest). */
export function rememberToken(data: OnlineStore, code: string, token: string): OnlineStore {
  const tokens = { ...data.tokens };
  delete tokens[code];
  tokens[code] = token;
  return { ...data, tokens };
}

export function forgetToken(data: OnlineStore, code: string): OnlineStore {
  const tokens = { ...data.tokens };
  delete tokens[code];
  return { ...data, tokens };
}
