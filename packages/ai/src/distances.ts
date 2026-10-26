import type { BoardContext } from '@hrady/engine';

/** Step counts between nodes, ignoring who holds what. */
export interface Distances {
  /** Steps from `from` to `to`; {@link FAR} when knights cannot walk there. */
  get(from: string, to: string): number;
  /** Position of a node in the board order, for {@link at}. */
  index(id: string): number;
  /** Steps between two node indices: the fast path of {@link get}. */
  at(from: number, to: number): number;
}

export const FAR = 99;

const cache = new WeakMap<BoardContext, Distances>();

/**
 * All-pairs walking distances on a board: knights step along path markers,
 * leave start areas but never re-enter them, and a castle ends a walk (it is
 * reached, not passed through). Built once per board.
 */
export function distances(ctx: BoardContext): Distances {
  const cached = cache.get(ctx);
  if (cached) return cached;
  const ids = ctx.order;
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const table = new Uint8Array(n * n).fill(FAR);
  for (let s = 0; s < n; s++) {
    const row = s * n;
    table[row + s] = 0;
    const queue = [s];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!;
      if (i !== s && ctx.type(ids[i]!) !== 'path') continue;
      for (const next of ctx.neighbours(ids[i]!)) {
        const j = index.get(next)!;
        if (table[row + j] !== FAR || ctx.type(next) === 'start') continue;
        table[row + j] = table[row + i]! + 1;
        queue.push(j);
      }
    }
  }
  const result: Distances = {
    get(from, to) {
      const a = index.get(from);
      const b = index.get(to);
      return a === undefined || b === undefined ? FAR : table[a * n + b]!;
    },
    index(id) {
      const i = index.get(id);
      if (i === undefined) throw new RangeError(`unknown node ${id}`);
      return i;
    },
    at: (from, to) => table[from * n + to]!,
  };
  cache.set(ctx, result);
  return result;
}
