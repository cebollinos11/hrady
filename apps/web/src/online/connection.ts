import {
  PING,
  PONG,
  type ClientMessage,
  type Profile,
  type ProfileUpdate,
  type RoomMode,
  type RoomStatus,
  type ServerMessage,
} from '@hrady/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'gone';

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * A room's WebSocket that reconnects by itself. Every (re)connect starts with
 * `hello()` (which carries the latest reconnect token), so the server sends a
 * fresh snapshot each time. A ping every 25 s keeps proxies from dropping the
 * socket; the server answers it without waking up. The room is `gone` once
 * the server says so or no longer knows the code.
 */
export class Connection {
  status: ConnectionStatus = 'connecting';
  onMessage: (msg: ServerMessage) => void = () => {};
  onStatus: (status: ConnectionStatus) => void = () => {};
  private ws: WebSocket | null = null;
  private stopped = false;
  private failures = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private ping: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly url: string,
    private readonly hello: () => ClientMessage,
    /** Resolves to false when the server no longer knows the room. */
    private readonly exists: () => Promise<boolean>,
  ) {
    this.open();
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('online', this.wake);
  }

  private readonly wake = () => {
    if (!this.stopped && document.visibilityState === 'visible' && !this.ws) {
      clearTimeout(this.retry);
      this.open();
    }
  };

  private setStatus(status: ConnectionStatus) {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status);
  }

  private open() {
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let welcomed = false;
    ws.onopen = () => {
      ws.send(JSON.stringify(this.hello()));
      clearInterval(this.ping);
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(PING), PING_MS);
    };
    ws.onmessage = (e: MessageEvent<string>) => {
      if (e.data === PONG) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        welcomed = true;
        this.failures = 0;
        this.setStatus('open');
      }
      if (msg.type === 'closed') this.stop('gone');
      this.onMessage(msg);
    };
    ws.onclose = () => {
      clearInterval(this.ping);
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      this.setStatus('connecting');
      const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.failures++);
      // A socket that never got a welcome may mean the room is gone.
      const check = welcomed ? Promise.resolve(true) : this.exists().catch(() => true);
      void check.then((ok) => {
        if (this.stopped) return;
        if (!ok) this.stop('gone');
        else this.retry = setTimeout(() => this.open(), wait);
      });
    };
  }

  get connected() {
    return this.status === 'open' && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Sends a message; false if the socket is not open (the next welcome brings the client up to date). */
  send(msg: ClientMessage): boolean {
    if (!this.connected) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  /** Drops the socket and reconnects, to get a fresh snapshot. */
  resync() {
    this.ws?.close();
  }

  /** Stops for good and closes the socket. */
  close() {
    this.stop(this.status === 'gone' ? 'gone' : 'connecting');
  }

  private stop(status: ConnectionStatus) {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.ping);
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('online', this.wake);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.setStatus(status);
  }
}

/** `POST /api/rooms`: a new room and the creator's reconnect token. */
export async function createRoom(
  base: string,
  name: string,
  players: number,
  mode: RoomMode = 'live',
): Promise<{ code: string; token: string }> {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, players, mode }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    token?: string;
    error?: string;
  };
  if (!res.ok || !body.code || !body.token)
    throw new Error(body.error ?? `the server answered ${res.status}`);
  return { code: body.code, token: body.token };
}

/** `GET /api/rooms/:code`: whether the room exists. Throws on network errors. */
export async function roomExists(base: string, code: string): Promise<boolean> {
  const res = await fetch(`${base}/api/rooms/${encodeURIComponent(code)}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  return true;
}

/**
 * `POST /api/rooms/:code/status`: the room as seen by the holder of `token`,
 * or `null` if the room no longer exists. Throws on network errors.
 */
export async function roomStatus(
  base: string,
  code: string,
  token: string,
): Promise<RoomStatus | null> {
  const res = await fetch(`${base}/api/rooms/${encodeURIComponent(code)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  return (await res.json()) as RoomStatus;
}

const profileUrl = (base: string, name: string) =>
  `${base}/api/players/${encodeURIComponent(name)}`;

/** `GET /api/players/:name`: the games remembered for a username. Throws on network errors. */
export async function getProfile(base: string, name: string): Promise<Profile> {
  const res = await fetch(profileUrl(base, name));
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  return (await res.json()) as Profile;
}

/** `POST /api/players/:name`: remembers a game for a username, or forgets a room. */
export async function updateProfile(
  base: string,
  name: string,
  change: ProfileUpdate,
): Promise<void> {
  const res = await fetch(profileUrl(base, name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
}
