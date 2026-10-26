import hradyJson from '../hrady.json';
import type { BoardData, BoardNode, CastleNode, StartNode } from './types';
import { validateBoard } from './validate';

/** A validated board with adjacency lookups. */
export interface Board {
  readonly data: BoardData;
  readonly nodes: ReadonlyMap<string, BoardNode>;
  readonly starts: readonly StartNode[];
  readonly castles: readonly CastleNode[];
  /** Neighbour ids of a node, in edge order. Empty for unknown ids. */
  neighbours(id: string): readonly string[];
  /** The start node for a die roll (1–6). */
  startFor(roll: number): StartNode;
}

export class BoardValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid board:\n- ${problems.join('\n- ')}`);
    this.name = 'BoardValidationError';
  }
}

/** Validates raw JSON and builds a {@link Board}. Throws {@link BoardValidationError}. */
export function parseBoard(raw: unknown): Board {
  const problems = validateBoard(raw);
  if (problems.length) throw new BoardValidationError(problems);
  const data = raw as BoardData;

  const nodes = new Map(data.nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>(data.nodes.map((n) => [n.id, []]));
  for (const [a, b] of data.edges) {
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }
  const starts = data.nodes
    .filter((n): n is StartNode => n.type === 'start')
    .sort((a, b) => a.number - b.number);
  const castles = data.nodes.filter((n): n is CastleNode => n.type === 'castle');

  return {
    data,
    nodes,
    starts,
    castles,
    neighbours: (id) => adjacency.get(id) ?? [],
    startFor(roll) {
      const start = starts.find((s) => s.number === roll);
      if (!start) throw new RangeError(`no start area for roll ${roll}`);
      return start;
    },
  };
}

let hrady: Board | undefined;

/** The Hrady board from `hrady.json`, parsed once. */
export function loadHradyBoard(): Board {
  hrady ??= parseBoard(hradyJson);
  return hrady;
}
