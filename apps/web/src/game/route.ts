/**
 * Routes a dotted path between two points around round obstacles (castles,
 * markers, start areas): straight when nothing is in the way, otherwise the
 * shortest way round found on a grid, pulled taut and rounded off into a
 * smooth curve. Pure geometry in world units, deterministic.
 */

export interface Point {
  x: number;
  z: number;
}

/** Something a path must keep out of: a disc of radius `r`. */
export interface Obstacle extends Point {
  r: number;
}

/** Grid step of the search. */
const CELL = 0.06;
/** Extra room kept around obstacles when pulling the path taut, so rounding it off stays clear. */
const SLACK = 0.12;
/** Width of the band around an obstacle that the search avoids if it can. */
const HALO = 0.35;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function segmentGap(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Whether the segment `a`–`b` keeps `slack` clear of every obstacle. */
function clear(a: Point, b: Point, obstacles: readonly Obstacle[], slack: number): boolean {
  return obstacles.every((o) => segmentGap(o, a, b) >= o.r + slack);
}

/** Shortest polyline from `a` to `b` on the grid, avoiding the obstacles, or null. */
function search(
  a: Point,
  b: Point,
  obstacles: readonly Obstacle[],
  bounds: { width: number; depth: number },
): Point[] | null {
  const nx = Math.ceil(bounds.width / CELL) + 1;
  const nz = Math.ceil(bounds.depth / CELL) + 1;
  const x0 = -bounds.width / 2;
  const z0 = -bounds.depth / 2;
  const at = (i: number): Point => ({ x: x0 + (i % nx) * CELL, z: z0 + Math.floor(i / nx) * CELL });
  const cellOf = (p: Point) => Math.round((p.z - z0) / CELL) * nx + Math.round((p.x - x0) / CELL);

  // Cost of standing in each cell: blocked inside an obstacle, dearer close to one.
  const weight = new Float64Array(nx * nz);
  for (let i = 0; i < weight.length; i++) {
    const p = at(i);
    let w = 1;
    for (const o of obstacles) {
      const d = dist(p, o) - o.r - SLACK;
      if (d < 0) {
        w = Infinity;
        break;
      }
      if (d < HALO) w += 2 * (1 - d / HALO) ** 2;
    }
    weight[i] = w;
  }

  const start = cellOf(a);
  const goal = cellOf(b);
  weight[start] = weight[goal] = 1;
  const cost = new Float64Array(nx * nz).fill(Infinity);
  const from = new Int32Array(nx * nz).fill(-1);
  const pb = at(goal);
  const h = (i: number) => dist(at(i), pb);
  // Binary heap of [priority, cell].
  const heap: [number, number][] = [];
  const push = (e: [number, number]) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };

  // The 16 moves to cells up to two away that no shorter move lines up with.
  const steps: [number, number][] = [];
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++)
      if (Math.abs(dx) === 1 || Math.abs(dz) === 1) steps.push([dx, dz]);

  cost[start] = 0;
  push([h(start), start]);
  while (heap.length) {
    const [, i] = pop();
    if (i === goal) break;
    const ix = i % nx;
    const iz = Math.floor(i / nx);
    for (const [dx, dz] of steps) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const j = jz * nx + jx;
      if (!Number.isFinite(weight[j]!)) continue;
      const c = cost[i]! + Math.hypot(dx, dz) * CELL * (weight[i]! + weight[j]!) * 0.5;
      if (c < cost[j]!) {
        cost[j] = c;
        from[j] = i;
        push([c + h(j), j]);
      }
    }
  }
  if (from[goal] === -1) return null;
  const cells: Point[] = [];
  for (let i = goal; i !== -1; i = from[i]!) cells.push(at(i));
  cells.reverse();
  cells[0] = a;
  cells[cells.length - 1] = b;
  return cells;
}

/** Drops every point the path can skip in a straight line while keeping clear. */
function pull(path: Point[], obstacles: readonly Obstacle[]): Point[] {
  const out = [path[0]!];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !clear(path[i]!, path[j]!, obstacles, SLACK)) j--;
    out.push(path[j]!);
    i = j;
  }
  return out;
}

/** Rounds the corners off a polyline (Chaikin), keeping its ends. */
function round(path: Point[], times = 4): Point[] {
  let p = path;
  for (let k = 0; k < times && p.length > 2; k++) {
    const next = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      if (i > 0) next.push({ x: 0.75 * a.x + 0.25 * b.x, z: 0.75 * a.z + 0.25 * b.z });
      if (i < p.length - 2) next.push({ x: 0.25 * a.x + 0.75 * b.x, z: 0.25 * a.z + 0.75 * b.z });
    }
    next.push(p.at(-1)!);
    p = next;
  }
  return p;
}

/**
 * The course of a path from `a` to `b`, as a polyline from `a` to `b`: the
 * straight segment when it clears the obstacles, otherwise a smooth detour.
 * Falls back to the straight segment when there is no way round.
 */
export function route(
  a: Point,
  b: Point,
  obstacles: readonly Obstacle[],
  bounds: { width: number; depth: number },
): Point[] {
  if (clear(a, b, obstacles, 0)) return [a, b];
  const cells = search(a, b, obstacles, bounds);
  if (!cells) return [a, b];
  return round(pull(cells, obstacles));
}

/** Length of a polyline. */
export function pathLength(path: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += dist(path[i - 1]!, path[i]!);
  return len;
}

/** The point at arc length `s` along a polyline. */
export function pointAt(path: readonly Point[], s: number): Point {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const len = dist(a, b);
    if (s <= len || i === path.length - 1) {
      const t = len ? Math.max(0, Math.min(1, s / len)) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    s -= len;
  }
  return path[0]!;
}
