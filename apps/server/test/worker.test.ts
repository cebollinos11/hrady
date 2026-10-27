import { resolve } from 'node:path';
import type { ServerMessage } from '@hrady/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';

/**
 * The Worker and the GameRoom Durable Object running in workerd (Miniflare,
 * through wrangler), spoken to over real HTTP and WebSockets.
 */

let worker: Unstable_DevWorker;
let base: string;

beforeAll(async () => {
  const root = resolve(import.meta.dirname, '..');
  worker = await unstable_dev(resolve(root, 'src/index.ts'), {
    config: resolve(root, 'wrangler.toml'),
    local: true,
    persist: false,
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true },
  });
  base = `${worker.address}:${worker.port}`;
}, 60_000);

afterAll(async () => {
  await worker?.stop();
});

/** A WebSocket client that queues what it receives. */
class Socket {
  private queue: ServerMessage[] = [];
  private waiters: (() => void)[] = [];
  readonly ws: WebSocket;
  readonly opened: Promise<void>;

  constructor(code: string) {
    this.ws = new WebSocket(`ws://${base}/ws/${code}`);
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () => reject(new Error('socket failed')));
    });
    this.ws.addEventListener('message', (e) => {
      const data = String(e.data);
      if (data === 'pong') return;
      this.queue.push(JSON.parse(data) as ServerMessage);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  send(msg: unknown) {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** The next message of `type`, skipping others. */
  async next<T extends ServerMessage['type']>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const i = this.queue.findIndex((m) => m.type === type);
      if (i >= 0) return this.queue.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
      if (Date.now() > deadline) throw new Error(`no ${type} message`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 200);
      });
    }
  }

  close() {
    this.ws.close();
  }
}

async function createRoom(name: string, players = 3) {
  const res = await fetch(`http://${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.org' },
    body: JSON.stringify({ name, players }),
  });
  expect(res.status).toBe(201);
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  return (await res.json()) as { code: string; token: string };
}

describe('worker', () => {
  it('answers CORS preflights and unknown rooms', async () => {
    const pre = await fetch(`http://${base}/api/rooms`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.org', 'Access-Control-Request-Method': 'POST' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect((await fetch(`http://${base}/api/rooms/ZZZZZ`)).status).toBe(404);
    expect(
      (await fetch(`http://${base}/api/rooms`, { method: 'POST', body: '{"name":""}' })).status,
    ).toBe(400);
  });

  it(
    'runs a lobby and a game over WebSockets, and survives a reconnect',
    { timeout: 60_000 },
    async () => {
      const { code, token } = await createRoom('Ann');
      const info = await (await fetch(`http://${base}/api/rooms/${code.toLowerCase()}`)).json();
      expect(info).toMatchObject({ code, phase: 'lobby', players: 3 });

      const ann = new Socket(code);
      await ann.opened;
      ann.send({ type: 'hello', name: 'Ann', token });
      const welcome = await ann.next('welcome');
      expect(welcome.you).toEqual({ id: 'm1', token });

      ann.send('ping'); // answered by the runtime without waking the room
      ann.send('{not json');
      expect(await ann.next('error')).toMatchObject({ code: 'invalid' });

      const bea = new Socket(code);
      await bea.opened;
      bea.send({ type: 'hello', name: 'Bea' });
      const beaWelcome = await bea.next('welcome');
      expect(beaWelcome.room.seats[1]).toMatchObject({ type: 'human', name: 'Bea' });

      ann.send({ type: 'setSeat', seat: 2, kind: 'easy' });
      ann.send({ type: 'start' });
      const game = await ann.next('game');
      expect(game.game.view.viewer).toBe(0);
      expect(JSON.stringify(game)).not.toMatch(/"(seed|rng)"/);
      const beaGame = await bea.next('game');
      expect(beaGame.game.view.viewer).toBe(1);

      // Play until Bea's first roll, Ann standing in for the easy bot as AI host.
      const first = game.game.view.current;
      let at = 0;
      const turnOf = async (seat: number, socket: Socket) => {
        socket.send({ type: 'act', action: { type: 'roll', player: seat }, at });
        await socket.next('action');
        at++;
        socket.send({ type: 'act', action: { type: 'endTurn', player: seat }, at });
        await socket.next('action');
        at++;
      };
      for (let seat = first; seat !== 1; seat = (seat + 1) % 3) {
        if (seat === 2) expect((await ann.next('duty')).duty).toMatchObject({ seat: 2, at });
        await turnOf(seat, ann);
      }

      // Bea drops and comes back with her token: same member, whole log.
      bea.close();
      const again = new Socket(code);
      await again.opened;
      again.send({ type: 'hello', name: 'Bea', token: beaWelcome.you.token });
      const back = await again.next('welcome');
      expect(back.you.id).toBe(beaWelcome.you.id);
      expect(back.game?.log).toHaveLength(at);
      expect(back.game?.view.viewer).toBe(1);

      again.send({ type: 'act', action: { type: 'roll', player: 1 }, at });
      const rolled = await again.next('action');
      expect(rolled).toMatchObject({ at, entry: { action: { type: 'roll', player: 1 } } });
      ann.close();
      again.close();
    },
  );
});
