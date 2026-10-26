import type { BoardData, BoardNode, NodeType } from '@hrady/board';

/** Editing operations on a board draft. All of them mutate `board` in place. */

const ID_PREFIX: Record<NodeType, string> = { path: 'p', start: 's', castle: 'c' };

export function emptyBoard(): BoardData {
  return { version: 1, nodes: [], edges: [] };
}

export function findNode(board: BoardData, id: string): BoardNode | undefined {
  return board.nodes.find((n) => n.id === id);
}

/** Next free id for a type: p01, p02… for paths, s1… for starts, c01… for castles. */
export function nextId(board: BoardData, type: NodeType): string {
  const prefix = ID_PREFIX[type];
  const used = new Set(board.nodes.map((n) => n.id));
  for (let i = 1; ; i++) {
    const id = prefix + (type === 'start' ? String(i) : String(i).padStart(2, '0'));
    if (!used.has(id)) return id;
  }
}

/** Builds a node of `type` at (x, y), carrying over the id and any fields it can keep. */
function makeNode(
  board: BoardData,
  type: NodeType,
  id: string,
  x: number,
  y: number,
  from?: BoardNode,
): BoardNode {
  switch (type) {
    case 'path':
      return { id, type, x, y };
    case 'start': {
      const used = new Set(board.nodes.flatMap((n) => (n.type === 'start' ? [n.number] : [])));
      const number = [1, 2, 3, 4, 5, 6].find((n) => !used.has(n)) ?? 1;
      return { id, type, number, x, y };
    }
    case 'castle':
      return {
        id,
        type,
        name: from?.type === 'castle' ? from.name : `New castle ${id}`,
        value: from?.type === 'castle' ? from.value : 1,
        x,
        y,
      };
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function addNode(board: BoardData, type: NodeType, x: number, y: number): BoardNode {
  const node = makeNode(board, type, nextId(board, type), clamp01(x), clamp01(y));
  board.nodes.push(node);
  return node;
}

export function moveNode(board: BoardData, id: string, x: number, y: number): void {
  const node = findNode(board, id);
  if (node) {
    node.x = clamp01(x);
    node.y = clamp01(y);
  }
}

/** Removes a node and every edge touching it. */
export function deleteNode(board: BoardData, id: string): void {
  board.nodes = board.nodes.filter((n) => n.id !== id);
  board.edges = board.edges.filter(([a, b]) => a !== id && b !== id);
}

export function hasEdge(board: BoardData, a: string, b: string): boolean {
  return board.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** Connects two nodes, or disconnects them if already connected. Returns true if now connected. */
export function toggleEdge(board: BoardData, a: string, b: string): boolean {
  if (a === b || !findNode(board, a) || !findNode(board, b)) return false;
  if (hasEdge(board, a, b)) {
    board.edges = board.edges.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)));
    return false;
  }
  board.edges.push(a < b ? [a, b] : [b, a]);
  return true;
}

/** Changes a node's type in place, keeping its id, position and edges. */
export function setNodeType(board: BoardData, id: string, type: NodeType): void {
  const index = board.nodes.findIndex((n) => n.id === id);
  const old = board.nodes[index];
  if (!old || old.type === type) return;
  board.nodes[index] = makeNode(board, type, id, old.x, old.y, old);
}

/** Renames a node and rewrites its edges. Returns false if `to` is empty or taken. */
export function renameNode(board: BoardData, from: string, to: string): boolean {
  const node = findNode(board, from);
  if (!node || !to || (to !== from && findNode(board, to))) return false;
  node.id = to;
  board.edges = board.edges.map(([a, b]) => [a === from ? to : a, b === from ? to : b]);
  return true;
}
