import type { FigureSize } from './figures';
import { riverDistance, type Layout, type Point } from './layout';
import { hash } from './pixel/draw';
import type { Sprite } from './pixel/sprites';
import { clearance, heightAt } from './terrain';

/**
 * What differs between the pixel-art views of the board: how the world is
 * projected on the screen, how the ground and the sprites are drawn, and the
 * sizes the scene lays labels, rings and picking out with. The scene itself
 * (`pixelScene.ts`) is the same for all of them.
 */

/** World size of a ground tile, and of one height step. */
export const TILE = 0.4;
export const STEP = 0.1;
/** Height level of water tiles. */
export const WATER_LEVEL = -STEP;

export type Ground = 'grass' | 'hill' | 'rock' | 'sand' | 'water';

export interface Tree {
  p: Point;
  kind: number;
}

export interface Terrain {
  canvas: HTMLCanvasElement;
  /** Art coordinates of the canvas's top-left corner. */
  left: number;
  top: number;
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  /** Height level (world units) of each tile, `WATER_LEVEL` for water. */
  levels: Float32Array;
  water: { x: number; y: number; phase: number }[];
  trees: Tree[];
}

/** The board sampled on a grid of `TILE`-sized tiles. */
export interface Grid {
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  levels: Float32Array;
  kinds: Ground[];
}

export function sampleGround(layout: Layout): Grid {
  const nx = Math.ceil(layout.width / TILE);
  const nz = Math.ceil(layout.depth / TILE);
  const x0 = -(nx * TILE) / 2;
  const z0 = -(nz * TILE) / 2;
  const levels = new Float32Array(nx * nz);
  const kinds: Ground[] = new Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const p = tileCentre({ x0, z0 }, i, j);
      const h = heightAt(layout, p);
      const k = j * nx + i;
      if (h < -0.06) {
        levels[k] = WATER_LEVEL;
        kinds[k] = 'water';
        continue;
      }
      const level = Math.max(0, Math.round(h / STEP) * STEP);
      levels[k] = level;
      kinds[k] =
        level >= 0.4
          ? 'rock'
          : riverDistance(layout, p) < 0.3 && level === 0
            ? 'sand'
            : level >= 0.2
              ? 'hill'
              : 'grass';
    }
  return { nx, nz, x0, z0, levels, kinds };
}

export const tileCentre = (g: { x0: number; z0: number }, i: number, j: number): Point => ({
  x: g.x0 + (i + 0.5) * TILE,
  z: g.z0 + (j + 0.5) * TILE,
});

/** Trees on open ground, clear of every node and path. */
export function placeTrees(layout: Layout, g: Grid): Tree[] {
  const trees: Tree[] = [];
  for (let j = 1; j < g.nz - 1; j++)
    for (let i = 1; i < g.nx - 1; i++) {
      const kind = g.kinds[j * g.nx + i];
      if (kind !== 'grass' && kind !== 'hill') continue;
      if (hash(i, j, 11) > 0.16) continue;
      const p = tileCentre(g, i, j);
      const near = clearance(layout, p);
      if (near.node < 0.7 || near.edge < 0.45 || riverDistance(layout, p) < 0.25) continue;
      trees.push({
        p: { x: p.x + (hash(i, j, 12) - 0.5) * 0.3, z: p.z + (hash(i, j, 13) - 0.5) * 0.3 },
        kind: Math.floor(hash(i, j, 14) * 2),
      });
    }
  return trees;
}

export interface Look {
  /** Art coordinates of a world point at height `y` (world units, for hops and drops). */
  art(p: Point, y?: number): { x: number; y: number };
  /** Pixels a world height unit lifts something on the screen. */
  levelPx: number;
  hopPx: number;
  /** Height of a ground circle on the screen relative to its width. */
  squash: number;
  terrain(layout: Layout): Terrain;
  castle(colour: string | null, value: number): Sprite;
  knight(size: FigureSize, colour: string): Sprite;
  tree(kind: number): Sprite;
  knightHeight: Record<FigureSize, number>;
  /** World offset of a knight stack across the screen by `dx` units. */
  across(dx: number): Point;
  /** World offset of where knights stand in front of a castle. */
  front: Point;
  /** Offset of a figure from the middle of its stack, from the 3D arrangement (x right, z towards the viewer). */
  figure(f: { x: number; z: number }): Point;
  /** Half widths (x) of the rings round a path marker, a start scroll and a castle. */
  rings: { path: number; start: number; castle: number };
  /** Picking: the castle's box round its anchor and the marker radii. */
  hit: {
    castle: { hw: number; up: number; down: number };
    marker: [number, number];
    start: [number, number];
  };
  /** Art offsets from a castle's anchor: its name label, its shield and the top for popups. */
  castleLabel: number;
  shield: { x: number; y: number };
  popup: { castle: number; other: number };
  /** How far above a knight's feet the count badge floats, and a stack's extra height. */
  badge: number;
}
