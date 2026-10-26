/** Node kinds on the board graph. */
export type NodeType = 'start' | 'path' | 'castle';

interface NodeBase {
  /** Stable identifier, unique across the board. */
  id: string;
  /** Horizontal position, normalised 0..1 in image space (left → right). */
  x: number;
  /** Vertical position, normalised 0..1 in image space (top → bottom). */
  y: number;
}

/** A start scroll; `number` is the die roll (1–6) that places a knight here. */
export interface StartNode extends NodeBase {
  type: 'start';
  number: number;
}

/** A path marker (the coin spaces). */
export interface PathNode extends NodeBase {
  type: 'path';
}

/** A castle; `value` is its sword count (1–3). */
export interface CastleNode extends NodeBase {
  type: 'castle';
  name: string;
  value: number;
}

export type BoardNode = StartNode | PathNode | CastleNode;

/** Undirected connection between two node ids. */
export type BoardEdge = [string, string];

/** Serialised board, as stored in `hrady.json`. */
export interface BoardData {
  version: 1;
  /** Reference image the coordinates were traced from (editor only). */
  image?: { src: string; width: number; height: number };
  nodes: BoardNode[];
  edges: BoardEdge[];
}
