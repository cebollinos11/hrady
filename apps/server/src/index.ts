import { DurableObject } from 'cloudflare:workers';
import { echoReply, parseRoomPath } from './protocol';

export interface Env {
  ROOMS: DurableObjectNamespace<EchoRoom>;
}

/**
 * Hello-world room: echoes every message back to its sender. Uses the
 * WebSocket Hibernation API so an idle room costs no duration charges.
 */
export class EchoRoom extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const room = request.headers.get('X-Room') ?? '';
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [room]);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const [room = ''] = this.ctx.getTags(ws);
    ws.send(echoReply(message, room));
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('Hrady server is running.\n');

    const room = parseRoomPath(url.pathname);
    if (!room) return new Response('Not found\n', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected a WebSocket upgrade\n', { status: 426 });

    const headers = new Headers(request.headers);
    headers.set('X-Room', room);
    return env.ROOMS.getByName(room).fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;
