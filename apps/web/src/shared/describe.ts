import type { Board } from '@hrady/board';
import type { GameEvent, PlayerId } from '@hrady/engine';

export const PLAYER_NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple'] as const;
export const PLAYER_COLOURS = ['#d23c32', '#2f6fd6', '#e8b800', '#2e9e44', '#8e44c8'] as const;

export const playerName = (p: PlayerId) => PLAYER_NAMES[p] ?? `Player ${p + 1}`;

/** Human-readable name of a node: castle name, "start N" or the marker id. */
export function nodeName(board: Board, id: string): string {
  const node = board.nodes.get(id);
  if (node?.type === 'castle') return node.name;
  if (node?.type === 'start') return `start ${node.number}`;
  return id;
}

const places = new WeakMap<Board, Map<string, string>>();

/** Names of the castles by distance from a path marker, closest first, in board proportions. */
function castlesNear(board: Board, id: string): string[] {
  const node = board.nodes.get(id)!;
  // Graph coordinates are normalised to the board's width and height.
  const { width, height } = board.data.image ?? { width: 1, height: 1 };
  const aspect = width / height;
  return [...board.castles]
    .map((c) => ({ name: c.name, d: Math.hypot((c.x - node.x) * aspect, c.y - node.y) }))
    .sort((a, b) => a.d - b.d)
    .map((c) => c.name);
}

/** Names of every path marker; see `placeName`. */
function pathNames(board: Board): Map<string, string> {
  const names = new Map<string, string>();
  for (const node of board.data.nodes) {
    if (node.type !== 'path') continue;
    const near = castlesNear(board, node.id);
    const castle = board.neighbours(node.id).find((n) => board.nodes.get(n)?.type === 'castle');
    if (!castle) {
      names.set(node.id, `road by ${near[0] ?? node.id}`);
      continue;
    }
    const name = nodeName(board, castle);
    const entrances = board.neighbours(castle).filter((n) => board.nodes.get(n)?.type === 'path');
    // A castle with several entrances: each gate also says which castle it faces.
    const other = near.find((c) => c !== name);
    names.set(
      node.id,
      entrances.length > 1 && other ? `gate of ${name}, ${other} side` : `gate of ${name}`,
    );
  }
  return names;
}

/**
 * A name for a node that players can find on the board: castles and start
 * areas by name, a path marker after its castle when it is an entrance
 * ("gate of Kajetce", "gate of Kánovice, Roveň side" for a castle with two),
 * otherwise after the closest castle ("road by Kajetce"). Several markers can
 * share a road name; the log points them out on the board when hovered.
 */
export function placeName(board: Board, id: string): string {
  const node = board.nodes.get(id);
  if (node?.type !== 'path') return nodeName(board, id);
  let names = places.get(board);
  if (!names) places.set(board, (names = pathNames(board)));
  return names.get(id) ?? id;
}

/** The nodes an event is about, for pointing them out on the board. */
export function eventNodes(e: GameEvent): string[] {
  switch (e.type) {
    case 'knightPlaced':
    case 'placementSkipped':
    case 'spawnBlocked':
      return [e.start];
    case 'moved':
      return [e.from, e.to];
    case 'fieldBattle':
      return [...e.contributions.map((c) => c.from), e.target];
    case 'castleAttacked':
      return [e.from, e.castle];
    case 'castleConquered':
    case 'shieldPlaced':
      return [e.castle];
    case 'gameOver':
      return [e.lastCastle];
    default:
      return [];
  }
}

const knights = (n: number) => `${n} knight${n === 1 ? '' : 's'}`;

/** The stops of a move, "a → b → c", or "along the road by X" when they share one name. */
function route(stops: readonly string[]): string {
  const names = stops.filter((n, i) => n !== stops[i - 1]);
  return names.length === 1 ? `along the ${names[0]}` : names.join(' → ');
}

/** One line of the action log; `name` names the nodes (ids for path markers by default). */
export function describeEvent(
  board: Board,
  e: GameEvent,
  name: (board: Board, id: string) => string = nodeName,
): string {
  const who = playerName(e.player);
  const at = (id: string) => name(board, id);
  switch (e.type) {
    case 'rolled':
      return `${who} rolls ${e.value}`;
    case 'knightPlaced':
      return `${who} places a knight on ${at(e.start)}`;
    case 'placementSkipped':
      return `${who} already has a knight on ${at(e.start)} and cannot move it off: no placement`;
    case 'spawnBlocked':
      return `${who} already has a knight on ${at(e.start)}: it must move away before a new one spawns`;
    case 'moved':
      return `${who} moves ${knights(e.count)} ${route([at(e.from), at(e.to)])}`;
    case 'fieldBattle': {
      const from = e.contributions.map((c) => `${c.count} from ${at(c.from)}`).join(', ');
      return `${who} attacks ${at(e.target)} (${from}) and beats ${knights(e.defeated)} of ${playerName(e.defender)}`;
    }
    case 'castleAttacked': {
      const defence =
        e.defender === null
          ? `neutral, ${e.garrison} sword${e.garrison === 1 ? '' : 's'}`
          : `${playerName(e.defender)}, ${knights(e.garrison)}`;
      const shield = e.shield === null ? '' : `, shield ${e.shield}`;
      return `${who} attacks ${at(e.castle)} (${defence}${shield}) with ${e.attackers} from ${at(e.from)}: ${e.won ? 'won' : 'lost'}`;
    }
    case 'castleConquered':
      return `${who} takes ${at(e.castle)}, ${knights(e.count)} move${e.count === 1 ? 's' : ''} in`;
    case 'shieldPlaced':
      return `${who} places a shield on ${at(e.castle)}`;
    case 'turnEnded':
      return `${who} ends the turn`;
    case 'gameOver': {
      const points = e.points.map((p, i) => `${playerName(i)} ${p}`).join(', ');
      const winners = e.winners.map(playerName).join(' and ');
      return `Game over: ${at(e.lastCastle)} is the last neutral castle. ${points}. ${winners} win${e.winners.length === 1 ? 's' : ''}`;
    }
  }
}

/** A line of the log: an event, or a walk of several moves in a row merged into one. */
export interface LogLine {
  event: GameEvent;
  text: string;
  /** The nodes the line is about (every stop of a walk). */
  nodes: string[];
}

/** Log lines for events, merging moves that carry the same knights on. */
export function logLines(
  board: Board,
  events: readonly GameEvent[],
  name: (board: Board, id: string) => string = nodeName,
): LogLine[] {
  const lines: LogLine[] = [];
  for (const e of events) {
    const last = lines.at(-1);
    if (
      e.type === 'moved' &&
      last?.event.type === 'moved' &&
      last.event.player === e.player &&
      last.event.count === e.count &&
      last.nodes.at(-1) === e.from
    ) {
      last.nodes.push(e.to);
      const stops = route(last.nodes.map((id) => name(board, id)));
      last.text = `${playerName(e.player)} moves ${knights(e.count)} ${stops}`;
      continue;
    }
    lines.push({ event: e, text: describeEvent(board, e, name), nodes: eventNodes(e) });
  }
  return lines;
}
