import type { BoardData, BoardNode } from './types';

const KEY_ORDER = ['id', 'type', 'number', 'name', 'value', 'x', 'y'];
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const TYPE_ORDER = { path: 0, start: 1, castle: 2 } as const;

function inline(obj: object): string {
  const entries = Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{ ${entries.join(', ')} }`;
}

function nodeLine(node: BoardNode): string {
  const keys = Object.keys(node).sort((a, b) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(b));
  return inline(Object.fromEntries(keys.map((k) => [k, node[k as keyof BoardNode]])));
}

/**
 * Serialises a board in the layout used by `hrady.json`: one node or edge per
 * line, nodes grouped by type, edges sorted, coordinates rounded to 4 places.
 * Keeps diffs of hand-edited boards small.
 */
export function formatBoardJson(board: BoardData): string {
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  const nodes = board.nodes
    .map((n) => ({ ...n, x: round(n.x), y: round(n.y) }))
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
  const edges = board.edges
    .map(([a, b]): [string, string] => (a < b ? [a, b] : [b, a]))
    .sort(([a1, b1], [a2, b2]) => compare(a1, a2) || compare(b1, b2));

  const lines = ['{', '  "version": 1,'];
  if (board.image) lines.push(`  "image": ${inline(board.image)},`);
  lines.push('  "nodes": [');
  nodes.forEach((n, i) => lines.push(`    ${nodeLine(n)}${i < nodes.length - 1 ? ',' : ''}`));
  lines.push('  ],', '  "edges": [');
  edges.forEach(([a, b], i) =>
    lines.push(
      `    [${JSON.stringify(a)}, ${JSON.stringify(b)}]${i < edges.length - 1 ? ',' : ''}`,
    ),
  );
  lines.push('  ]', '}', '');
  return lines.join('\n');
}
