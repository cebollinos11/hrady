import {
  loadHradyBoard,
  parseBoard,
  type Board,
  type BoardData,
  type NodeType,
} from '@hrady/board';
import { seedRng } from './rng';
import {
  DEFAULT_RULES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type CastleState,
  type GameConfig,
  type GameState,
  type PlayerId,
  type ResolvedConfig,
} from './types';

/** Board lookups the rules need, built once per board. */
export interface BoardContext {
  board: Board;
  /** All node ids in board order; legal actions are listed in this order. */
  order: readonly string[];
  castleIds: readonly string[];
  type(id: string): NodeType | undefined;
  adjacent(a: string, b: string): boolean;
  /** Neighbour ids in board order. */
  neighbours(id: string): readonly string[];
  castleValue(id: string): number;
}

function buildContext(board: Board): BoardContext {
  const order = board.data.nodes.map((n) => n.id);
  const index = new Map(order.map((id, i) => [id, i]));
  const adjacency = new Map<string, Set<string>>();
  const sorted = new Map<string, string[]>();
  for (const id of order) {
    adjacency.set(id, new Set(board.neighbours(id)));
    sorted.set(
      id,
      [...board.neighbours(id)].sort((a, b) => index.get(a)! - index.get(b)!),
    );
  }
  const types = new Map([...board.nodes.values()].map((n) => [n.id, n.type]));
  const values = new Map(board.castles.map((c) => [c.id, c.value]));
  return {
    board,
    order,
    castleIds: board.castles.map((c) => c.id),
    type: (id) => types.get(id),
    adjacent: (a, b) => adjacency.get(a)?.has(b) ?? false,
    neighbours: (id) => sorted.get(id) ?? [],
    castleValue: (id) => values.get(id) ?? 0,
  };
}

let hradyContext: BoardContext | undefined;
const customContexts = new WeakMap<BoardData, BoardContext>();

/** The board context for a game; parsed boards are cached per config object. */
export function boardContext(config: ResolvedConfig): BoardContext {
  if (!config.board) return (hradyContext ??= buildContext(loadHradyBoard()));
  let ctx = customContexts.get(config.board);
  if (!ctx) {
    ctx = buildContext(parseBoard(config.board));
    customContexts.set(config.board, ctx);
  }
  return ctx;
}

export function resolveConfig(config: GameConfig): ResolvedConfig {
  const { players, firstPlayer = 0 } = config;
  if (!Number.isInteger(players) || players < MIN_PLAYERS || players > MAX_PLAYERS)
    throw new RangeError(`players must be ${MIN_PLAYERS}–${MAX_PLAYERS}, got ${players}`);
  if (!Number.isInteger(firstPlayer) || firstPlayer < 0 || firstPlayer >= players)
    throw new RangeError(`firstPlayer must be a seat 0–${players - 1}, got ${firstPlayer}`);
  const rules = { ...DEFAULT_RULES, ...config.rules };
  if (!Number.isInteger(rules.movePoints) || rules.movePoints < 1)
    throw new RangeError(`movePoints must be a positive integer, got ${rules.movePoints}`);
  return {
    players,
    firstPlayer,
    board: config.board ?? null,
    rules: { movePoints: rules.movePoints, shieldValues: [...rules.shieldValues] },
  };
}

/** A new game: every castle neutral, no knights, the first player to roll. */
export function initialState(config: GameConfig, seed: number): GameState {
  const resolved = resolveConfig(config);
  const ctx = boardContext(resolved);
  const castles: Record<string, CastleState> = {};
  for (const id of ctx.castleIds) castles[id] = { owner: null, shield: null };
  return {
    config: resolved,
    rng: seedRng(seed),
    turn: 1,
    current: resolved.firstPlayer,
    phase: 'roll',
    roll: null,
    mp: 0,
    knights: {},
    castles,
    shields: Array.from({ length: resolved.players }, () => [...resolved.rules.shieldValues]),
    pendingShield: null,
    pendingSpawn: null,
    end: null,
  };
}

/**
 * A shallow copy for the reducer. The knight, castle and shield records are
 * new objects, but their entries are shared: replace an entry, never mutate
 * it (the helpers below do this). The config is shared and never mutated.
 */
export function copyState(state: GameState): GameState {
  return {
    ...state,
    knights: copyRecord(state.knights),
    castles: copyRecord(state.castles),
    shields: [...state.shields],
  };
}

// A for-in copy stays fast for records that `delete` moved to dictionary mode.
function copyRecord<T>(record: Record<string, T>): Record<string, T> {
  const copy: Record<string, T> = {};
  for (const key in record) copy[key] = record[key]!;
  return copy;
}

/** A player's knights on a node. */
export function knightsAt(state: GameState, node: string, player: PlayerId): number {
  return state.knights[node]?.[player] ?? 0;
}

/** The player holding a path marker or castle, or `null` if it is empty. */
export function holder(state: GameState, node: string): PlayerId | null {
  const counts = state.knights[node];
  if (!counts) return null;
  const player = counts.findIndex((n) => n > 0);
  return player < 0 ? null : player;
}

/** Knights each player has on the board (start areas, markers and castles). */
export function knightsOnBoard(state: GameState): number[] {
  const totals = new Array<number>(state.config.players).fill(0);
  for (const id in state.knights) {
    const counts = state.knights[id]!;
    for (let p = 0; p < counts.length; p++) totals[p]! += counts[p]!;
  }
  return totals;
}

/** Adds knights to a node of a {@link copyState} copy. */
export function addKnights(state: GameState, node: string, player: PlayerId, n: number): void {
  const counts = state.knights[node]?.slice() ?? new Array<number>(state.config.players).fill(0);
  counts[player] = (counts[player] ?? 0) + n;
  state.knights[node] = counts;
}

/** Removes knights from a node of a {@link copyState} copy, dropping empty entries. */
export function removeKnights(state: GameState, node: string, player: PlayerId, n: number): void {
  const counts = state.knights[node]?.slice();
  if (!counts || (counts[player] ?? 0) < n)
    throw new Error(`cannot remove ${n} knights of player ${player} from ${node}`);
  counts[player] = (counts[player] ?? 0) - n;
  if (counts.every((c) => c === 0)) delete state.knights[node];
  else state.knights[node] = counts;
}

/** A castle record of a {@link copyState} copy that may be mutated. */
export function editCastle(state: GameState, castle: string): CastleState {
  const c = state.castles[castle]!;
  const copy = { owner: c.owner, shield: c.shield && { ...c.shield } };
  state.castles[castle] = copy;
  return copy;
}

/** Castles never conquered so far. */
export function neutralCastles(state: GameState): string[] {
  return Object.keys(state.castles).filter((id) => state.castles[id]?.owner === null);
}
