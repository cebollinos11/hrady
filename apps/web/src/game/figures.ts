import type { Point } from './layout';

/** The three knight figures of the game: one, two and five knights. */
export type FigureSize = 1 | 2 | 5;

/**
 * The figures showing a stack of `count` knights: as many fives as fit, then
 * twos, then ones (the rules let players swap figures freely, and the supply is
 * unlimited, so this is purely visual).
 */
export function compose(count: number): FigureSize[] {
  const out: FigureSize[] = [];
  let left = Math.max(0, Math.floor(count));
  for (const size of [5, 2, 1] as const) {
    while (left >= size) {
      out.push(size);
      left -= size;
    }
  }
  return out;
}

/** Footprint radius of a figure, for spacing. */
export const FIGURE_RADIUS: Record<FigureSize, number> = { 1: 0.07, 2: 0.085, 5: 0.1 };

export interface PlacedFigure {
  size: FigureSize;
  x: number;
  z: number;
}

/**
 * Places figures around a centre: up to four in a small ring, more with the
 * largest one in the middle and rings of 6, 12… around it. Larger figures
 * come first, at the back (−z), so they do not hide the small ones from the
 * default camera. Positions are relative to the node centre.
 */
export function arrange(sizes: readonly FigureSize[], spacing = 0.18): PlacedFigure[] {
  const sorted = [...sizes].sort((a, b) => b - a);
  if (sorted.length <= 1) return sorted.map((size) => ({ size, x: 0, z: 0 }));
  const out: PlacedFigure[] = [];
  const ring = (from: number, n: number, r: number) => {
    for (let k = 0; k < n; k++) {
      const a = Math.PI + (2 * Math.PI * k) / n;
      out.push({ size: sorted[from + k]!, x: Math.sin(a) * r, z: Math.cos(a) * r });
    }
  };
  if (sorted.length <= 4) {
    ring(0, sorted.length, spacing * 0.6);
    return out;
  }
  out.push({ size: sorted[0]!, x: 0, z: 0 });
  for (let i = 1, k = 1; i < sorted.length; k++) {
    const n = Math.min(6 * k, sorted.length - i);
    ring(i, n, spacing * k);
    i += n;
  }
  return out;
}

/**
 * Where each colour stands on a start area holding several colours: side by
 * side across the area, in player order. Returns offsets keyed by player.
 */
export function startSlots(players: readonly number[], width: number): Map<number, Point> {
  const slots = new Map<number, Point>();
  const n = players.length;
  const step = n > 1 ? Math.min(0.24, (width * 0.85) / (n - 1)) : 0;
  players.forEach((p, i) => slots.set(p, { x: (i - (n - 1) / 2) * step, z: 0.06 }));
  return slots;
}
