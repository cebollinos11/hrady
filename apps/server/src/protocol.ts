/** Room codes: 4–12 letters or digits, case-insensitive. */
const ROOM_PATH = /^\/ws\/([A-Za-z0-9]{4,12})\/?$/;

/** Extracts the normalised room code from `/ws/:room`, or null if the path doesn't match. */
export function parseRoomPath(pathname: string): string | null {
  const match = ROOM_PATH.exec(pathname);
  return match?.[1] ? match[1].toUpperCase() : null;
}

/** The reply the echo room sends for an incoming WebSocket message. */
export function echoReply(message: string | ArrayBuffer, room: string): string {
  const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
  return JSON.stringify({ type: 'echo', room, data: text });
}
