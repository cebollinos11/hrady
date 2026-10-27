import { START_SIZE, type Layout, type Point } from './layout';
import { TILE, placeTrees, sampleGround, tileCentre, type Look, type Terrain } from './look';
import { drawPaths, ellipse, hash } from './pixel/draw';
import { drawText, textWidth } from './pixel/font';
import {
  FIGURE_SPRITE_HEIGHT,
  canvasOf,
  castleSprite,
  darken,
  diamond,
  knightSprite,
  lighten,
  treeSprite,
  type Ctx,
} from './pixel/sprites';

/**
 * The isometric look, in the style of the old Civilization / Age of Empires
 * games: the ground is a grid of diamond tiles drawn once; castles, knights
 * and trees are sprites sorted back to front by the scene.
 *
 * Art coordinates: a world point (x, z) at height y sits at
 * ((x − z) · PX, (x + z) · PY − y · PH), with the world origin at (0, 0).
 */

const PX = 20;
const PY = 10;
const PH = 20;
/** How far below the lowest ground the board's edge goes. */
const BASE = -0.5;

/** Art coordinates of a world point at `y` (world height units). */
const art = (p: Point, y = 0) => ({
  x: Math.round((p.x - p.z) * PX),
  y: Math.round((p.x + p.z) * PY - y * PH),
});

const PALETTE = {
  grass: ['#5fa046', '#58983f', '#68a84c'],
  hill: ['#4a8a3a', '#437f36', '#52923f'],
  rock: ['#8d8a7c', '#7f7c70', '#9a978a'],
  sand: ['#d8c487', '#cdb97a', '#e0cd94'],
  water: ['#3b82cf', '#3478c4', '#2f6db8'],
};
const SKIRT = {
  earth: ['#5e4630', '#7a5c3c'],
  rock: ['#6d6a5e', '#85826f'],
  sand: ['#a8955e', '#bfab70'],
};

function buildTerrain(layout: Layout): Terrain {
  const grid = sampleGround(layout);
  const { nx, nz, x0, z0, levels, kinds } = grid;
  const centre = (i: number, j: number) => tileCentre(grid, i, j);

  // Canvas bounds: the four corners of the board plus the tallest ground and the base.
  const corners = [
    { x: x0, z: z0 },
    { x: -x0, z: z0 },
    { x: x0, z: -z0 },
    { x: -x0, z: -z0 },
  ];
  const maxLevel = Math.max(...levels, 0);
  const xs = corners.map((c) => (c.x - c.z) * PX);
  const ys = corners.map((c) => (c.x + c.z) * PY);
  const left = Math.floor(Math.min(...xs)) - 4;
  const top = Math.floor(Math.min(...ys) - maxLevel * PH) - 6;
  const width = Math.ceil(Math.max(...xs)) - left + 4;
  const height = Math.ceil(Math.max(...ys) - BASE * PH) - top + 4;
  const [canvas, ctx] = canvasOf(width, height);
  ctx.translate(-left, -top);

  const levelAt = (i: number, j: number) =>
    i < 0 || j < 0 || i >= nx || j >= nz ? BASE : levels[j * nx + i]!;
  const water: Terrain['water'] = [];
  const hw = TILE * PX;

  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const kind = kinds[k]!;
      const level = levels[k]!;
      const c = art(centre(i, j));
      const cy = c.y - Math.round(level * PH);
      const shade = Math.floor(hash(i, j) * 3);
      // Side walls where the ground drops to the tile in front (below left / right).
      if (kind !== 'water') {
        const wall = kind === 'rock' ? SKIRT.rock : kind === 'sand' ? SKIRT.sand : SKIRT.earth;
        const lip = PALETTE[kind][1]!;
        const faces: [number, number, string][] = [
          [-1, levelAt(i, j + 1), wall[0]!],
          [1, levelAt(i + 1, j), wall[1]!],
        ];
        for (const [side, below, colour] of faces) {
          const drop = Math.round((level - below) * PH);
          if (drop <= 0) continue;
          for (let d = 0; d < hw; d++) {
            const dx = side < 0 ? -hw + d : d;
            const edge = side < 0 ? Math.floor((hw + dx + 1) / 2) : Math.floor((hw - dx) / 2);
            ctx.fillStyle = colour;
            ctx.fillRect(c.x + dx, cy + edge, 1, drop);
            ctx.fillStyle = lip;
            ctx.fillRect(c.x + dx, cy + edge, 1, 1);
          }
        }
      } else {
        // Banks: the land above the water shows its wall (drawn by the land tile);
        // the water itself is flat.
      }
      diamond(ctx, c.x, cy, hw, PALETTE[kind][shade]!);
      if (kind === 'water') {
        water.push({ x: c.x, y: cy, phase: hash(i, j, 3) });
        continue;
      }
      const dress = hash(i, j, 1);
      if (kind === 'grass' || kind === 'hill') {
        if (dress < 0.35) {
          ctx.fillStyle = darken(PALETTE[kind][shade]!, 0.18);
          ctx.fillRect(c.x - 3 + Math.floor(hash(i, j, 4) * 5), cy - 1, 1, 1);
          ctx.fillRect(c.x + Math.floor(hash(i, j, 5) * 5), cy + 1, 2, 1);
        } else if (dress < 0.5) {
          ctx.fillStyle = lighten(PALETTE[kind][shade]!, 0.15);
          ctx.fillRect(c.x - 2 + Math.floor(hash(i, j, 6) * 4), cy, 2, 1);
        }
        if (kind === 'grass' && dress > 0.97) {
          ctx.fillStyle = hash(i, j, 8) < 0.5 ? '#f4e04a' : '#ea84a8';
          ctx.fillRect(c.x - 2 + Math.floor(hash(i, j, 7) * 4), cy, 1, 1);
        }
      } else if (kind === 'rock' && dress < 0.4) {
        ctx.fillStyle = darken(PALETTE.rock[shade]!, 0.2);
        ctx.fillRect(c.x - 2, cy, 3, 1);
      }
    }

  // Flat things on the ground, drawn over the finished terrain.
  const lift = (p: Point) => {
    const i = Math.floor((p.x - x0) / TILE);
    const j = Math.floor((p.z - z0) / TILE);
    return Math.round(Math.max(0, levelAt(i, j)) * PH);
  };
  const onGround = (p: Point) => {
    const a = art(p);
    return { x: a.x, y: a.y - lift(p) };
  };
  drawFlat(ctx, layout, onGround);

  const trees = placeTrees(layout, grid);
  return { canvas, left, top, nx, nz, x0, z0, levels, water, trees };
}

/** Plots a pixel line (Bresenham). */
function drawFlat(ctx: Ctx, layout: Layout, onGround: (p: Point) => { x: number; y: number }) {
  drawPaths(ctx, layout, onGround, art);
  for (const n of layout.nodes.values()) {
    const a = onGround(n.pos);
    if (n.node.type === 'path') {
      ellipse(ctx, a.x, a.y + 1, 8, 4, '#4a4036');
      ellipse(ctx, a.x, a.y, 8, 4, '#b9ad93');
      ellipse(ctx, a.x, a.y, 6, 3, '#d9cdb0');
    } else if (n.node.type === 'start') {
      drawScroll(ctx, a, n.node.number);
    } else {
      ellipse(ctx, a.x, a.y + 2, 17, 8, '#4a4036');
      ellipse(ctx, a.x, a.y + 1, 17, 8, '#9d917c');
      ellipse(ctx, a.x, a.y, 15, 7, '#b3a78f');
    }
  }
}

/** A start scroll lying on the ground: parchment, rolled ends and the die number. */
function drawScroll(ctx: Ctx, a: { x: number; y: number }, number: number) {
  const hx = START_SIZE.width / 2;
  const hz = START_SIZE.depth / 2;
  const covers = (px: number, py: number, grow = 0) => {
    const u = px / PX;
    const v = py / PY;
    const x = (u + v) / 2;
    const z = (v - u) / 2;
    return Math.abs(x) <= hx + grow && Math.abs(z) <= hz + grow;
  };
  for (let py = -14; py <= 14; py++)
    for (let px = -22; px <= 22; px++) {
      if (!covers(px, py, 0.03)) continue;
      const u = px / PX;
      const v = py / PY;
      const x = (u + v) / 2;
      const edge = Math.abs(x) > hx - 0.07;
      ctx.fillStyle = edge ? '#b89c68' : covers(px, py + 1, -0.03) ? '#efe2c0' : '#e0d1a4';
      ctx.fillRect(a.x + px, a.y + py, 1, 1);
      if (!covers(px, py - 1, 0.03)) {
        ctx.fillStyle = '#7a6440';
        ctx.fillRect(a.x + px, a.y + py - 1, 1, 1);
      }
    }
  drawText(
    ctx,
    String(number),
    a.x - Math.floor(textWidth(String(number)) / 2),
    a.y - 2,
    '#7a1c16',
  );
}

export const ISO_LOOK: Look = {
  art,
  levelPx: PH,
  hopPx: PH,
  squash: 0.5,
  terrain: buildTerrain,
  castle: castleSprite,
  knight: knightSprite,
  tree: treeSprite,
  knightHeight: FIGURE_SPRITE_HEIGHT,
  across: (dx) => ({ x: dx * 0.7071, z: -dx * 0.7071 }),
  front: { x: 0.62, z: 0.62 },
  // The arrangement puts big figures at the back (−z) for the 3D camera; here that is −x −z.
  figure: (f) => ({ x: (f.x + f.z) * 0.7071, z: (f.z - f.x) * 0.7071 }),
  rings: { path: 11, start: 24, castle: 20 },
  hit: { castle: { hw: 15, up: 40, down: 16 }, marker: [11, 11], start: [22, 11] },
  castleLabel: 49,
  shield: { x: 15, y: -34 },
  popup: { castle: 58, other: 26 },
  badge: 6,
};
