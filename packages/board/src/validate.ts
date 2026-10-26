import type { BoardData, BoardNode, CastleNode, StartNode } from './types';

export const START_COUNT = 6;
export const CASTLE_COUNT = 18;

const NODE_TYPES = new Set(['start', 'path', 'castle']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Checks that `raw` has the shape of {@link BoardData}. Returns a list of
 * problems; an empty list means the data can be used as `BoardData`.
 */
export function validateShape(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return ['board must be an object'];
  if (raw.version !== 1) errors.push(`unsupported version ${String(raw.version)}`);
  if (!Array.isArray(raw.nodes)) errors.push('nodes must be an array');
  if (!Array.isArray(raw.edges)) errors.push('edges must be an array');
  if (errors.length) return errors;

  (raw.nodes as unknown[]).forEach((n, i) => {
    const where = `nodes[${i}]`;
    if (!isRecord(n)) return errors.push(`${where} must be an object`);
    if (typeof n.id !== 'string' || n.id === '')
      errors.push(`${where}.id must be a non-empty string`);
    if (typeof n.type !== 'string' || !NODE_TYPES.has(n.type))
      errors.push(`${where}.type must be one of start, path, castle`);
    for (const k of ['x', 'y'] as const) {
      const v = n[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
        errors.push(`${where}.${k} must be a number in 0..1`);
    }
    if (n.type === 'start' && typeof n.number !== 'number')
      errors.push(`${where}.number must be a number`);
    if (n.type === 'castle') {
      if (typeof n.name !== 'string') errors.push(`${where}.name must be a string`);
      if (typeof n.value !== 'number') errors.push(`${where}.value must be a number`);
    }
  });
  (raw.edges as unknown[]).forEach((e, i) => {
    if (!Array.isArray(e) || e.length !== 2 || !e.every((v) => typeof v === 'string'))
      errors.push(`edges[${i}] must be a pair of node ids`);
  });
  return errors;
}

/**
 * Checks graph integrity: unique ids, no dangling, self or duplicate edges,
 * and a connected graph. Holds for any draft board, not just Hrady.
 */
export function validateGraph(board: BoardData): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const n of board.nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id "${n.id}"`);
    ids.add(n.id);
  }

  const adjacency = new Map<string, Set<string>>([...ids].map((id) => [id, new Set()]));
  const seen = new Set<string>();
  for (const [a, b] of board.edges) {
    if (!ids.has(a) || !ids.has(b)) {
      errors.push(`edge ${a}–${b} references a missing node`);
      continue;
    }
    if (a === b) {
      errors.push(`edge ${a}–${b} is a self loop`);
      continue;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) errors.push(`duplicate edge ${a}–${b}`);
    seen.add(key);
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }

  const first = board.nodes[0];
  if (first) {
    const reached = new Set([first.id]);
    const queue = [first.id];
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
      for (const next of adjacency.get(id) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    const unreached = [...ids].filter((id) => !reached.has(id));
    if (unreached.length)
      errors.push(`graph is not connected; unreachable: ${unreached.join(', ')}`);
  }
  return errors;
}

/**
 * Checks the Hrady-specific rules: 6 starts numbered 1–6, 18 uniquely named
 * castles worth 1–3 swords, and every castle reachable from a path marker.
 */
export function validateHradyRules(board: BoardData): string[] {
  const errors: string[] = [];
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const starts = board.nodes.filter((n): n is StartNode => n.type === 'start');
  const castles = board.nodes.filter((n): n is CastleNode => n.type === 'castle');

  if (starts.length !== START_COUNT)
    errors.push(`expected ${START_COUNT} starts, found ${starts.length}`);
  const numbers = starts.map((s) => s.number).sort((a, b) => a - b);
  const expected = Array.from({ length: START_COUNT }, (_, i) => i + 1);
  if (numbers.join() !== expected.join())
    errors.push(`start numbers must be exactly 1–6, found [${numbers.join(', ')}]`);

  if (castles.length !== CASTLE_COUNT)
    errors.push(`expected ${CASTLE_COUNT} castles, found ${castles.length}`);
  const names = new Set<string>();
  for (const c of castles) {
    const name = c.name.trim();
    if (!name) errors.push(`castle ${c.id} has no name`);
    else if (names.has(name)) errors.push(`duplicate castle name "${name}"`);
    names.add(name);
    if (!Number.isInteger(c.value) || c.value < 1 || c.value > 3)
      errors.push(`castle ${c.id} value must be 1–3, found ${c.value}`);
  }

  const neighbours = (id: string): BoardNode[] =>
    board.edges
      .filter(([a, b]) => a === id || b === id)
      .map(([a, b]) => byId.get(a === id ? b : a))
      .filter((n): n is BoardNode => n !== undefined);
  for (const c of castles) {
    if (!neighbours(c.id).some((n) => n.type === 'path'))
      errors.push(`castle ${c.id} is not adjacent to any path marker`);
  }
  for (const s of starts) {
    if (!neighbours(s.id).some((n) => n.type === 'path'))
      errors.push(`start ${s.id} is not adjacent to any path marker`);
  }
  return errors;
}

/** All checks: shape first, then graph integrity and Hrady rules. */
export function validateBoard(raw: unknown): string[] {
  const shape = validateShape(raw);
  if (shape.length) return shape;
  const board = raw as BoardData;
  return [...validateGraph(board), ...validateHradyRules(board)];
}
