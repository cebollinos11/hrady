import type { Board, BoardNode } from '@hrady/board';
import { pathLength, pointAt, route, type Obstacle } from './route';

/**
 * Where everything sits on the 3D board, computed from the board graph only.
 * World units: the graph is spread over `graph.depth` = 15 units from top (-z)
 * to bottom (+z) and `WIDEN` times as wide as its aspect ratio says, which
 * leaves more room between the nodes and for the river; the board adds a
 * `MARGIN` all round so pieces and paths near the edge stay on it. y is up.
 * Nothing here depends on node ids or on the exact shape of the traced graph.
 */

/** Board size in graph units when the graph has no reference size. */
const DEFAULT_SIZE = { width: 876, height: 1200 };
export const BOARD_DEPTH = 15;
/** How much wider than the photo's aspect ratio the graph is laid out. */
export const WIDEN = 1.35;
/** Free border between the graph's extent and the board edge. */
export const MARGIN = 0.55;

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
  /** Course of the path from `a` to `b`: straight, or curving round what is in the way. */
  path: Point[];
  dots: Point[];
}

/**
 * A castle entrance: an arrowhead pointing at the castle, just in front of it,
 * and dots leading to it from the marker when the two are far apart.
 */
export interface Entrance {
  castle: string;
  marker: string;
  pos: Point;
  /** Angle (radians, around y, 0 = pointing +z) of the arrow. */
  angle: number;
  dots: Point[];
}

/** How far an entrance arrow reaches forwards and backwards from its position. */
export const ARROW_TIP = 0.13;
export const ARROW_TAIL = 0.065;

export interface Layout {
  /** Board size, margins included. */
  width: number;
  depth: number;
  /** Area the normalised graph coordinates are mapped onto (see `toWorld`). */
  graph: { width: number; depth: number };
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
  { x: 0.43, y: -0.05, half: 0.078 },
  { x: 0.45, y: 0.08, half: 0.078 },
  { x: 0.44, y: 0.17, half: 0.078 },
  { x: 0.46, y: 0.25, half: 0.078 },
  { x: 0.46, y: 0.33, half: 0.078 },
  { x: 0.47, y: 0.42, half: 0.078 },
  { x: 0.5, y: 0.5, half: 0.075 },
  { x: 0.53, y: 0.58, half: 0.08 },
  { x: 0.55, y: 0.67, half: 0.08 },
  { x: 0.59, y: 0.75, half: 0.07 },
  { x: 0.6, y: 0.83, half: 0.085 },
  { x: 0.55, y: 0.92, half: 0.12 },
  { x: 0.55, y: 1.05, half: 0.17 },
];

/** Area the graph is mapped onto, in world units. */
export function graphSize(board: Board) {
  const { width, height } = board.data.image ?? DEFAULT_SIZE;
  return { width: (width / height) * BOARD_DEPTH * WIDEN, depth: BOARD_DEPTH };
}

/** Maps normalised graph coordinates (0..1) onto the graph area, centred on the origin. */
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

/** Evenly spaced dots along a path, from where it leaves the rim at its start to the rim at its end. */
export function dotsAlong(path: readonly Point[], ra: number, rb: number, spacing = 0.16): Point[] {
  if (path.length === 2) return dotsBetween(path[0]!, path[1]!, ra, rb, spacing);
  const a = path[0]!;
  const b = path.at(-1)!;
  const len = pathLength(path);
  const fine = 0.01;
  let s0 = 0;
  while (s0 < len && distance(pointAt(path, s0), a) < ra) s0 += fine;
  let s1 = len;
  while (s1 > s0 && distance(pointAt(path, s1), b) < rb) s1 -= fine;
  const free = s1 - s0;
  if (free <= spacing) return [];
  const n = Math.floor(free / spacing);
  const step = free / (n + 1);
  return Array.from({ length: n }, (_, i) => pointAt(path, s0 + step * (i + 1)));
}

/** Room kept between a dotted path and the pieces it winds past. */
export const PATH_CLEARANCE = 0.08;

/** Closest a connection that does not touch a start area may pass by its centre. */
export const START_CLEARANCE = 0.62;

/**
 * Moves path markers so that no connection between two of them runs under a
 * start scroll. On the board such paths pass just behind the scroll; here both
 * markers are pushed away from the scroll (outwards, towards the board edge,
 * when the path runs straight through it) until the path clears it. Markers
 * stay `margin` inside the board.
 */
export function clearStarts(
  board: Board,
  nodes: Map<string, NodeLayout>,
  bounds: { width: number; depth: number },
  margin = MARKER_RADIUS + 0.12,
) {
  const hx = bounds.width / 2 - margin;
  const hz = bounds.depth / 2 - margin;
  for (const start of board.starts) {
    const s = nodes.get(start.id)!.pos;
    for (const [a, b] of board.data.edges) {
      const na = nodes.get(a)!;
      const nb = nodes.get(b)!;
      if (na.node.type !== 'path' || nb.node.type !== 'path') continue;
      const { d, t } = segmentDistance(s, na.pos, nb.pos);
      if (d >= START_CLEARANCE) continue;
      const cx = na.pos.x + (nb.pos.x - na.pos.x) * t;
      const cz = na.pos.z + (nb.pos.z - na.pos.z) * t;
      // Away from the scroll; straight outwards if the path runs through its centre.
      let dx = cx - s.x;
      let dz = cz - s.z;
      if (Math.hypot(dx, dz) < 1e-6) [dx, dz] = [Math.sign(s.x) || 1, 0];
      const len = Math.hypot(dx, dz);
      const push = START_CLEARANCE - d;
      for (const n of [na, nb])
        n.pos = {
          x: Math.max(-hx, Math.min(hx, n.pos.x + (dx / len) * push)),
          z: Math.max(-hz, Math.min(hz, n.pos.z + (dz / len) * push)),
        };
    }
  }
}

/**
 * Nudges castles off the connections between markers that run through them,
 * and away from other nodes they crowd, so that fewer paths need to wind
 * round them. Each castle settles where those pushes balance out; markers
 * and start areas stay put, and no castle moves more than `reach` from where
 * the graph puts it: past that, the paths go round it instead.
 */
export function clearCastles(
  board: Board,
  nodes: Map<string, NodeLayout>,
  reach = 0.3,
  rounds = 40,
) {
  const home = new Map(board.castles.map((c) => [c.id, nodes.get(c.id)!.pos]));
  const links = board.data.edges
    .map(([a, b]) => [nodes.get(a)!, nodes.get(b)!] as const)
    .filter(([a, b]) => a.node.type !== 'castle' && b.node.type !== 'castle');
  for (let k = 0; k < rounds; k++) {
    for (const castle of board.castles) {
      const c = nodes.get(castle.id)!;
      const rc = nodeRadius(c.node) + PATH_CLEARANCE;
      let px = 0;
      let pz = 0;
      const away = (from: Point, need: number, d: number) => {
        if (d >= need) return;
        let dx = c.pos.x - from.x;
        let dz = c.pos.z - from.z;
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) [dx, dz] = [0, 1];
        else [dx, dz] = [dx / len, dz / len];
        px += dx * (need - d);
        pz += dz * (need - d);
      };
      for (const [a, b] of links) {
        const { d, t } = segmentDistance(c.pos, a.pos, b.pos);
        const p = { x: a.pos.x + (b.pos.x - a.pos.x) * t, z: a.pos.z + (b.pos.z - a.pos.z) * t };
        away(p, rc + 0.05, d);
      }
      for (const n of nodes.values()) {
        if (n === c) continue;
        away(n.pos, rc + nodeRadius(n.node) + 0.05, distance(c.pos, n.pos));
      }
      const h = home.get(castle.id)!;
      let dx = c.pos.x + px * 0.3 - h.x;
      let dz = c.pos.z + pz * 0.3 - h.z;
      const moved = Math.hypot(dx, dz);
      if (moved > reach) [dx, dz] = [(dx / moved) * reach, (dz / moved) * reach];
      c.pos = { x: h.x + dx, z: h.z + dz };
    }
  }
}

export function buildLayout(board: Board): Layout {
  const size = graphSize(board);
  const width = size.width + 2 * MARGIN;
  const depth = size.depth + 2 * MARGIN;
  const nodes = new Map<string, NodeLayout>();
  for (const node of board.data.nodes)
    nodes.set(node.id, { id: node.id, node, pos: toWorld(size, node.x, node.y), facing: 0 });
  clearStarts(board, nodes, { width, depth });
  clearCastles(board, nodes);

  const entrances: Entrance[] = [];
  const paths: [NodeLayout, NodeLayout][] = [];
  for (const [a, b] of board.data.edges) {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    const castle = na.node.type === 'castle' ? na : nb.node.type === 'castle' ? nb : null;
    if (!castle) {
      paths.push([na, nb]);
      continue;
    }
    const marker = castle === na ? nb : na;
    const angle = heading(marker.pos, castle.pos);
    const len = distance(marker.pos, castle.pos);
    // As close to the castle as it goes, but never back into the marker.
    const r = Math.max(
      nodeRadius(marker.node) + ARROW_TAIL + 0.03,
      len - nodeRadius(castle.node) - ARROW_TIP - 0.05,
    );
    const dots = dotsBetween(marker.pos, castle.pos, nodeRadius(marker.node), len - r + ARROW_TAIL);
    entrances.push({
      castle: castle.id,
      marker: marker.id,
      angle,
      pos: { x: marker.pos.x + Math.sin(angle) * r, z: marker.pos.z + Math.cos(angle) * r },
      dots,
    });
  }

  // Paths between markers wind round the castles, markers, start areas and
  // entrance arrows in their way.
  const pieces: (Obstacle & { id?: string })[] = [
    ...[...nodes.values()].map((n) => ({
      id: n.id,
      ...n.pos,
      r: nodeRadius(n.node) + PATH_CLEARANCE,
    })),
    ...entrances.map((e) => ({ ...e.pos, r: ARROW_TIP + PATH_CLEARANCE / 2 })),
  ];
  const bounds = {
    width: width - 2 * (MARKER_RADIUS + 0.12),
    depth: depth - 2 * (MARKER_RADIUS + 0.12),
  };
  const edges: DottedEdge[] = paths.map(([na, nb]) => {
    const obstacles = pieces.filter((o) => o.id !== na.id && o.id !== nb.id);
    const path = route(na.pos, nb.pos, obstacles, bounds);
    return {
      a: na.id,
      b: nb.id,
      path,
      dots: dotsAlong(path, nodeRadius(na.node), nodeRadius(nb.node)),
    };
  });

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

  return {
    width,
    depth,
    graph: size,
    nodes,
    edges,
    entrances,
    river: [...RHINE],
  };
}

/**
 * The way a knight walks from node `from` to the neighbouring node `to`,
 * centre to centre: along the dotted path, curves and all, or straight for a
 * castle entrance.
 */
export function course(layout: Layout, from: string, to: string): Point[] {
  for (const e of layout.edges) {
    if (e.a === from && e.b === to) return e.path;
    if (e.a === to && e.b === from) return [...e.path].reverse();
  }
  return [layout.nodes.get(from)!.pos, layout.nodes.get(to)!.pos];
}

/**
 * Signed distance from a world point to the river bank: negative in the water.
 * The river is the union of capsules along the centreline whose radius is
 * interpolated between its points.
 */
export function riverDistance(layout: Layout, p: Point): number {
  let best = Infinity;
  const size = layout.graph;
  for (let i = 1; i < layout.river.length; i++) {
    const ra = layout.river[i - 1]!;
    const rb = layout.river[i]!;
    const a = toWorld(size, ra.x, ra.y);
    const b = toWorld(size, rb.x, rb.y);
    const { d, t } = segmentDistance(p, a, b);
    const half = (ra.half + (rb.half - ra.half) * t) * size.width;
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
