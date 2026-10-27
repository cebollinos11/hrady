import { DurableObject } from 'cloudflare:workers';
import {
  PING,
  PONG,
  ProtocolError,
  makeCode,
  parseClientMessage,
  parseCreateRoom,
  type CreateRoomResponse,
  type LogEntry,
  type RoomInfo,
  type ServerMessage,
} from '@hrady/protocol';
import {
  createRoom,
  disconnect,
  nextAlarm,
  receive,
  reconcile,
  roomInfo,
  tick,
  type Context,
  type Result,
  type Room,
} from './room';
import { allowOrigin, route } from './routes';

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  /** Comma-separated origins allowed to call the API and open sockets, or `*`. */
  ALLOWED_ORIGINS?: string;
}

interface Attachment {
  member: string;
}

/** Uniform in `[0, 1)` from the platform's cryptographic RNG. */
const cryptoRandom = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

const logKey = (i: number) => `log:${String(i).padStart(6, '0')}`;

/**
 * One room: lobby and game. The room (seats, members, the game state) is one
 * storage value, `room`; each applied action and its events is a `log:NNNNNN`
 * value. Sockets use the Hibernation API, so an idle room costs nothing and
 * survives being evicted from memory; the alarm drives turn timers and expiry.
 * All decisions are made by the pure functions in `room.ts`.
 */
export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;
  /** The stored log, loaded on first use. */
  private log: LogEntry[] | null = null;
  private alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    void ctx.blockConcurrencyWhile(async () => {
      const room = await ctx.storage.get<Room>('room');
      this.alarmAt = await ctx.storage.getAlarm();
      if (room) this.room = reconcile(room, this.liveMembers(), Date.now());
    });
  }

  /** Called by the Worker for `POST /api/rooms`; `null` if the code is taken. */
  async create(code: string, name: string, players: number): Promise<{ token: string } | null> {
    if (this.room) return null;
    const { room, token } = createRoom(code, name, players, {
      now: Date.now(),
      random: cryptoRandom,
    });
    await this.commit({ room, out: [] });
    return { token };
  }

  /** Called by the Worker for `GET /api/rooms/:code`. */
  async info(): Promise<RoomInfo | null> {
    return this.room && roomInfo(this.room, Date.now());
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected a WebSocket upgrade\n', { status: 426 });
    if (!this.room) return new Response('No such room\n', { status: 404 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.room) {
      send(ws, { type: 'closed', reason: 'The room no longer exists.' });
      ws.close(1000, 'room closed');
      return;
    }
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let msg;
    try {
      msg = parseClientMessage(text);
    } catch (e) {
      const reason = e instanceof ProtocolError ? e.message : 'bad message';
      send(ws, { type: 'error', message: reason, code: 'invalid' });
      return;
    }
    const from = memberOf(ws);
    // The welcome carries the log; the room logic reads it synchronously.
    if (msg.type === 'hello' && this.room.game) await this.loadLog();
    await this.commit(receive(this.room, from, msg, this.context()), ws);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.closed(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      // Already closed.
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.closed(ws);
  }

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    if (this.room) await this.commit(tick(this.room, { now: Date.now() }));
  }

  private async closed(ws: WebSocket) {
    const id = memberOf(ws);
    if (!this.room || id === null) return;
    const others = this.ctx.getWebSockets().some((s) => s !== ws && memberOf(s) === id);
    if (!others) await this.commit(disconnect(this.room, id, { now: Date.now() }));
  }

  private liveMembers(): Set<string> {
    const live = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const id = memberOf(ws);
      if (id !== null) live.add(id);
    }
    return live;
  }

  private context(): Context {
    return { now: Date.now(), random: cryptoRandom, history: () => this.history() };
  }

  /** The cached log; `webSocketMessage` loads it before a `hello`, the only input that reads it. */
  private history(): LogEntry[] {
    return this.log ?? [];
  }

  private async loadLog(): Promise<LogEntry[]> {
    if (!this.log) {
      const entries = await this.ctx.storage.list<LogEntry>({ prefix: 'log:' });
      this.log = [...entries.values()];
    }
    return this.log;
  }

  /** Stores the result, sends its messages and sets the next alarm. */
  private async commit(result: Result, ws?: WebSocket) {
    const storage = this.ctx.storage;
    if (result.member && ws) ws.serializeAttachment({ member: result.member } satisfies Attachment);

    if (result.destroy) {
      this.deliver(result, ws);
      for (const s of this.ctx.getWebSockets()) s.close(1000, 'room closed');
      this.room = null;
      this.log = null;
      this.alarmAt = null;
      await storage.deleteAlarm();
      await storage.deleteAll();
      return;
    }

    const log = result.truncate !== undefined || result.append ? await this.loadLog() : null;
    if (log && result.truncate !== undefined) {
      const keys = [];
      for (let i = result.truncate; i < log.length; i++) keys.push(logKey(i));
      log.length = result.truncate;
      for (let i = 0; i < keys.length; i += 128) await storage.delete(keys.slice(i, i + 128));
    }
    const writes: Record<string, unknown> = {};
    if (log && result.append)
      for (const entry of result.append) {
        writes[logKey(log.length)] = entry;
        log.push(entry);
      }
    if (result.room !== this.room) writes.room = result.room;
    this.room = result.room;
    if (Object.keys(writes).length) await storage.put(writes);

    this.deliver(result, ws);
    const next = nextAlarm(this.room);
    if (next !== this.alarmAt) {
      this.alarmAt = next;
      await storage.setAlarm(next);
    }
  }

  private deliver(result: Result, ws?: WebSocket) {
    const sockets = this.ctx.getWebSockets();
    for (const { to, msg } of result.out) {
      const text = JSON.stringify(msg);
      if (to === null) {
        if (ws) send(ws, text);
        continue;
      }
      for (const s of sockets) if (memberOf(s) === to) send(s, text);
    }
    for (const id of result.close ?? [])
      for (const s of sockets) if (memberOf(s) === id) s.close(1000, 'left');
  }
}

function memberOf(ws: WebSocket): string | null {
  const a = ws.deserializeAttachment() as Attachment | null;
  return a?.member ?? null;
}

function send(ws: WebSocket, msg: ServerMessage | string) {
  try {
    ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  } catch {
    // The socket is closing; the member will get a snapshot on reconnect.
  }
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = allowOrigin(origin, env.ALLOWED_ORIGINS);
    const cors: Record<string, string> = allowed
      ? { 'Access-Control-Allow-Origin': allowed, Vary: 'Origin' }
      : {};
    // Browsers always send an Origin on cross-origin requests and WebSocket upgrades.
    if (origin && !allowed) return new Response('Origin not allowed\n', { status: 403 });

    const r = route(request.method, url.pathname);
    switch (r.kind) {
      case 'preflight':
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        });
      case 'home':
        return new Response('Hrady server is running.\n', { headers: cors });
      case 'create': {
        let body;
        try {
          const text = await request.text();
          if (text.length > 1024) throw new ProtocolError('request too large');
          body = parseCreateRoom(JSON.parse(text));
        } catch (e) {
          return json({ error: e instanceof ProtocolError ? e.message : 'bad request' }, 400, cors);
        }
        for (let attempt = 0; attempt < 8; attempt++) {
          const code = makeCode(cryptoRandom);
          const created = await env.ROOMS.getByName(code).create(
            code,
            body.name,
            body.players ?? 3,
          );
          if (created)
            return json({ code, token: created.token } satisfies CreateRoomResponse, 201, cors);
        }
        return json({ error: 'no free room code, try again' }, 503, cors);
      }
      case 'info': {
        const info = await env.ROOMS.getByName(r.code).info();
        return info ? json(info, 200, cors) : json({ error: 'no such room' }, 404, cors);
      }
      case 'socket':
        if (request.headers.get('Upgrade') !== 'websocket')
          return new Response('Expected a WebSocket upgrade\n', { status: 426, headers: cors });
        return env.ROOMS.getByName(r.code).fetch(request);
      case 'notFound':
        return new Response('Not found\n', { status: 404, headers: cors });
    }
  },
} satisfies ExportedHandler<Env>;
