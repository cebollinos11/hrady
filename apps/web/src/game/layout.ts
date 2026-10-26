import type { Board, BoardNode } from '@hrady/board';

/**
 * Where everything sits on the 3D board, computed from the board graph only.
 * World units: the board is `depth` = 12 units from top (-z) to bottom (+z)
 * and as wide as the graph's aspect ratio says; y is up. Nothing here depends
 * on node ids or on the exact shape of the traced graph.
 */

/** Board size in graph units when the graph has no reference size. */
const DEFAULT_SIZE = { width: 876, height: 1200 };
export const BOARD_DEPTH = 12;

/** Radius of a path marker, and of the area kept flat around each node. */
export const MARKER_RADIUS = 0.27;
export const START_SIZE = { width: 0.7, depth: 0.5 };
/** Water surface height; land is at y ≥ 0. */
export const WATER_Y = -0.07;

export interface Point {
  x: number;
  z: number;
}

export interface NodeLayout {
  id: string;
  node: BoardNode;
  pos: Point;
  /** Castles: angle (radians, around y, 0 = facing +z) towards their entrance(s). */
  facing: number;
}

export interface DottedEdge {
  a: string;
  b: string;
  dots: Point[];
}

/** A castle entrance: an arrowhead on the marker pointing at the castle. */
export interface Entrance {
  castle: string;
  marker: string;
  pos: Point;
  /** Angle (radians, around y, 0 = pointing +z) of the arrow. */
  angle: number;
}

export interface Layout {
  width: number;
  depth: number;
  nodes: Map<string, NodeLayout>;
  /** Dotted connections between path markers and start areas. */
  edges: DottedEdge[];
  entrances: Entrance[];
  river: RiverPoint[];
}

/**
 * The Rhine as a centreline in normalised board coordinates (like the graph)
 * with a half width in the same x units. It is an original, simplified course
 * running down the middle of the board and widening towards the bottom; the
 * graph does not describe the river, so it is drawn independently of it.
 * Markers and castles that fall into it become islets (see `terrain.ts`).
 */
export interface RiverPoint {
  x: number;
  y: number;
  half: number;
}

export const RHINE: readonly RiverPoint[] = [
  { x: 0.43, y: -0.05, half: 0.07 },
  { x: 0.45, y: 0.08, half: 0.07 },
  { x: 0.44, y: 0.17, half: 0.065 },
  { x: 0.46, y: 0.25, half: 0.065 },
  { x: 0.46, y: 0.33, half: 0.065 },
  { x: 0.47, y: 0.42, half: 0.07 },
  { x: 0.5, y: 0.5, half: 0.065 },
  { x: 0.53, y: 0.58, half: 0.08 },
  { x: 0.55, y: 0.67, half: 0.08 },
  { x: 0.59, y: 0.75, half: 0.06 },
  { x: 0.6, y: 0.83, half: 0.085 },
  { x: 0.55, y: 0.92, half: 0.12 },
  { x: 0.55, y: 1.05, half: 0.17 },
];

export function boardSize(board: Board) {
  const { width, height } = board.data.image ?? DEFAULT_SIZE;
  return { width: (width / height) * BOARD_DEPTH, depth: BOARD_DEPTH };
}

/** Maps normalised graph coordinates (0..1) onto the board, centred on the origin. */
export function toWorld(size: { width: number; depth: number }, x: number, y: number): Point {
  return { x: (x - 0.5) * size.width, z: (y - 0.5) * size.depth };
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Angle around y of the direction from `a` to `b`, 0 along +z (three.js `rotation.y`). */
export const heading = (a: Point, b: Point) => Math.atan2(b.x - a.x, b.z - a.z);

/** Distance from `p` to the segment `a`–`b`, and where along it (0..1) the closest point is. */
export function segmentDistance(p: Point, a: Point, b: Point): { d: number; t: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
  return { d: Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)), t };
}

/** Clearance around a node before its connections start. */
export function nodeRadius(node: BoardNode): number {
  if (node.type === 'start') return START_SIZE.width / 2;
  if (node.type === 'castle') return 0.45;
  return MARKER_RADIUS;
}

/** Evenly spaced dots between two node rims, `spacing` apart at most. */
export function dotsBetween(a: Point, b: Point, ra: number, rb: number, spacing = 0.16): Point[] {
  const len = distance(a, b);
  const free = len - ra - rb;
  if (free <= spacing) return [];
  const n = Math.floor(free / spacing);
  const step = free / (n + 1);
  return Array.from({ length: n }, (_, i) => {
    const t = (ra + step * (i + 1)) / len;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  });
}

export function buildLayout(board: Board): Layout {
  const size = boardSize(board);
  const nodes = new Map<string, NodeLayout>();
  for (const node of board.data.nodes)
    nodes.set(node.id, { id: node.id, node, pos: toWorld(size, node.x, node.y), facing: 0 });

  const edges: DottedEdge[] = [];
  const entrances: Entrance[] = [];
  for (const [a, b] of board.data.edges) {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    const castle = na.node.type === 'castle' ? na : nb.node.type === 'castle' ? nb : null;
    if (castle) {
      const marker = castle === na ? nb : na;
      const angle = heading(marker.pos, castle.pos);
      const r = nodeRadius(marker.node) + 0.1;
      entrances.push({
        castle: castle.id,
        marker: marker.id,
        angle,
        pos: { x: marker.pos.x + Math.sin(angle) * r, z: marker.pos.z + Math.cos(angle) * r },
      });
    } else {
      const dots = dotsBetween(na.pos, nb.pos, nodeRadius(na.node), nodeRadius(nb.node));
      edges.push({ a, b, dots });
    }
  }

  // Castles face their entrance (the mean direction when there are several).
  for (const castle of board.castles) {
    const layout = nodes.get(castle.id)!;
    let sx = 0;
    let sz = 0;
    for (const id of board.neighbours(castle.id)) {
      const n = nodes.get(id)!.pos;
      const len = distance(layout.pos, n) || 1;
      sx += (n.x - layout.pos.x) / len;
      sz += (n.z - layout.pos.z) / len;
    }
    layout.facing = sx || sz ? Math.atan2(sx, sz) : 0;
  }

  return { ...size, nodes, edges, entrances, river: [...RHINE] };
}

/**
 * Signed distance from a world point to the river bank: negative in the water.
 * The river is the union of capsules along the centreline whose radius is
 * interpolated between its points.
 */
export function riverDistance(layout: Layout, p: Point): number {
  let best = Infinity;
  const size = { width: layout.width, depth: layout.depth };
  for (let i = 1; i < layout.river.length; i++) {
    const ra = layout.river[i - 1]!;
    const rb = layout.river[i]!;
    const a = toWorld(size, ra.x, ra.y);
    const b = toWorld(size, rb.x, rb.y);
    const { d, t } = segmentDistance(p, a, b);
    const half = (ra.half + (rb.half - ra.half) * t) * layout.width;
    best = Math.min(best, d - half);
  }
  return best;
}

/** The node closest to `p` and how far it is. */
export function nearestNode(layout: Layout, p: Point): { id: string; d: number } | null {
  let best: { id: string; d: number } | null = null;
  for (const n of layout.nodes.values()) {
    const d = distance(n.pos, p) - nodeRadius(n.node);
    if (!best || d < best.d) best = { id: n.id, d };
  }
  return best;
}

/**
 * Camera distance from a point to fit a `width` × `depth` rectangle seen
 * straight down, with a perspective camera of vertical field of view `fov`
 * (degrees) and `aspect` = width / height of the viewport.
 */
export function fitDistance(width: number, depth: number, fov: number, aspect: number): number {
  const tan = Math.tan((fov * Math.PI) / 360);
  return Math.max(depth / 2 / tan, width / 2 / (tan * aspect));
}

/** Keeps a camera target over the board. */
export function clampToBoard(layout: Layout, p: Point, margin = 0): Point {
  const hx = layout.width / 2 - margin;
  const hz = layout.depth / 2 - margin;
  return { x: Math.max(-hx, Math.min(hx, p.x)), z: Math.max(-hz, Math.min(hz, p.z)) };
}
