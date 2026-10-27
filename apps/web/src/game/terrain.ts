import {
  WATER_Y,
  nodeRadius,
  riverDistance,
  segmentDistance,
  type Layout,
  type Point,
} from './layout';

/**
 * Procedural low-poly terrain: rolling hills that flatten out around every
 * node and connection so pieces stand level, and a river bed that dips under
 * the water. Nodes in the river get a small islet. Deterministic: the same
 * layout always gives the same landscape.
 */

/** Height of the flat ground the pieces stand on. */
export const GROUND_Y = 0;
const HILL_HEIGHT = 0.55;
const RIVER_DEPTH = 0.35;

function hash(x: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in 0..1 on a unit lattice. */
function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash(ix, iz) + (hash(ix + 1, iz) - hash(ix, iz)) * fx;
  const b = hash(ix, iz + 1) + (hash(ix + 1, iz + 1) - hash(ix, iz + 1)) * fx;
  return a + (b - a) * fz;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return smooth(t);
}

/** Hills before flattening, 0..1. */
export function hills(p: Point): number {
  return 0.65 * noise(p.x * 0.9 + 17, p.z * 0.9 + 3) + 0.35 * noise(p.x * 2.3 - 5, p.z * 2.3 + 11);
}

/** Distance from `p` to the nearest node rim and to the nearest connection. */
export function clearance(layout: Layout, p: Point): { node: number; edge: number } {
  let node = Infinity;
  for (const n of layout.nodes.values())
    node = Math.min(node, Math.hypot(n.pos.x - p.x, n.pos.z - p.z) - nodeRadius(n.node));
  let edge = Infinity;
  for (const e of layout.edges)
    for (let i = 1; i < e.path.length; i++)
      edge = Math.min(edge, segmentDistance(p, e.path[i - 1]!, e.path[i]!).d);
  for (const e of layout.entrances) {
    const a = layout.nodes.get(e.marker)!.pos;
    const b = layout.nodes.get(e.castle)!.pos;
    edge = Math.min(edge, segmentDistance(p, a, b).d);
  }
  return { node, edge };
}

/** Terrain height at a world point. */
export function heightAt(layout: Layout, p: Point): number {
  const { node, edge } = clearance(layout, p);
  const open = smoothstep(0.1, 0.8, Math.min(node, edge));
  const river = riverDistance(layout, p);
  // 0 on the bank, 1 in the middle of the river.
  const wet = smoothstep(0.05, -0.25, river);
  // Hills rise away from the river too.
  const dry = smoothstep(0, 0.6, river);
  const land = GROUND_Y + hills(p) * HILL_HEIGHT * open * dry;
  const bed = WATER_Y - 0.03 - RIVER_DEPTH * smoothstep(0, 1, -river);
  const h = land + (bed - land) * wet;
  // Islets: nodes always stand on dry, level ground.
  const islet = 1 - smoothstep(0.02, 0.16, node);
  return h + (GROUND_Y - h) * islet;
}

/** Ground colour (r, g, b in 0..1) for a height and a slope (0 flat .. 1 steep). */
export function groundColour(h: number, slope: number): [number, number, number] {
  if (h < WATER_Y + 0.01) return [0.78, 0.72, 0.52]; // sandy bed under the water
  if (h < GROUND_Y + 0.03 && slope < 0.3) return [0.42, 0.62, 0.27]; // meadow
  if (h > 0.42) return [0.55, 0.52, 0.46]; // rocky tops
  if (slope > 0.55) return [0.46, 0.4, 0.3]; // steep earth
  const t = Math.min(1, h / 0.42);
  return [0.36 - 0.08 * t, 0.56 - 0.12 * t, 0.24 - 0.04 * t];
}
