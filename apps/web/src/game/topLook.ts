import { START_SIZE, type Layout, type Point } from './layout';
import { TILE, placeTrees, sampleGround, tileCentre, type Look, type Terrain } from './look';
import { drawPaths, ellipse, hash } from './pixel/draw';
import { drawText, textWidth } from './pixel/font';
import { canvasOf, darken, lighten } from './pixel/sprites';
import { TOP_FIGURE_HEIGHT, topCastle, topKnight, topTree } from './pixel/topSprites';

/**
 * The top-down look: the board as a map seen from straight above, in the
 * style of the 16-bit adventure games. Ground tiles are squares, a world
 * point (x, z) sits at (x · S, z · S), and the heights of the land show only
 * as lighter tops and a shadow under each ledge.
 */

/** Pixels per world unit: a ground tile is 10 pixels. */
const S = 25;

const art = (p: Point, y = 0) => ({ x: Math.round(p.x * S), y: Math.round(p.z * S - y * 14) });

const PALETTE = {
  grass: ['#5c9b45', '#5a9843', '#5e9e47'],
  hill: ['#5a9643', '#589441', '#5c9945'],
  rock: ['#88897a', '#85867a', '#8b8c7d'],
  sand: ['#d2c18a', '#cfbd86', '#d5c48e'],
  water: ['#3a7fca', '#387cc7', '#3b82cd'],
};

function buildTerrain(layout: Layout): Terrain {
  const grid = sampleGround(layout);
  const { nx, nz, x0, z0, levels, kinds } = grid;
  const px = TILE * S;
  const left = Math.floor(x0 * S) - 4;
  const top = Math.floor(z0 * S) - 4;
  const [canvas, ctx] = canvasOf(Math.ceil(nx * px) + 8, Math.ceil(nz * px) + 8);
  ctx.translate(-left, -top);
  const level = (i: number, j: number) =>
    i < 0 || j < 0 || i >= nx || j >= nz ? 0 : levels[j * nx + i]!;
  const water: Terrain['water'] = [];

  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const kind = kinds[k]!;
      const h = levels[k]!;
      const c = art(tileCentre(grid, i, j));
      const x = c.x - px / 2;
      const y = c.y - px / 2;
      const shade = Math.floor(hash(i, j) * 3);
      let colour = PALETTE[kind][shade]!;
      if (kind !== 'water') colour = lighten(colour, h * 0.08);
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, px, px);
      if (kind === 'water') {
        water.push({ x: c.x, y: c.y, phase: hash(i, j, 3) });
        continue;
      }
      const dress = hash(i, j, 1);
      if (kind === 'grass' || kind === 'hill') {
        ctx.fillStyle = darken(colour, 0.16);
        if (dress < 0.15) {
          ctx.fillRect(x + 1 + Math.floor(hash(i, j, 4) * 7), y + 2, 1, 2);
          ctx.fillRect(x + 1 + Math.floor(hash(i, j, 5) * 7), y + 6, 2, 1);
        }
      } else if (kind === 'rock' && dress < 0.5) {
        ctx.fillStyle = darken(colour, 0.2);
        ctx.fillRect(x + 2, y + 3, 3, 1);
        ctx.fillRect(x + 5, y + 7, 2, 1);
      }
      // A ledge: the ground drops below this tile, so it casts a shadow on it.
      const drop = h - level(i, j + 1);
      if (drop > 0.01) {
        ctx.fillStyle = darken(colour, kind === 'sand' ? 0.12 : 0.18);
        ctx.fillRect(x, y + px - (drop > 0.15 ? 3 : 2), px, drop > 0.15 ? 3 : 2);
      }
      if (h - level(i + 1, j) > 0.01) {
        ctx.fillStyle = darken(colour, 0.08);
        ctx.fillRect(x + px - 1, y, 1, px);
      }
    }

  // The edge of the board.
  ctx.strokeStyle = '#1b1410';
  ctx.lineWidth = 2;
  ctx.strokeRect(left + 5, top + 5, canvas.width - 10, canvas.height - 10);
  ctx.setTransform(1, 0, 0, 1, -left, -top);

  const onGround = (p: Point) => art(p);
  drawPaths(ctx, layout, onGround, art);
  for (const n of layout.nodes.values()) {
    const a = art(n.pos);
    if (n.node.type === 'path') {
      ellipse(ctx, a.x, a.y + 1, 6, 6, '#4a4036');
      ellipse(ctx, a.x, a.y, 6, 6, '#b9ad93');
      ellipse(ctx, a.x, a.y, 4, 4, '#d9cdb0');
    } else if (n.node.type === 'start') {
      const hx = Math.round((START_SIZE.width / 2) * S);
      const hz = Math.round((START_SIZE.depth / 2) * S);
      ctx.fillStyle = '#4a4036';
      ctx.fillRect(a.x - hx, a.y - hz + 1, 2 * hx, 2 * hz);
      ctx.fillStyle = '#b89c68';
      ctx.fillRect(a.x - hx, a.y - hz, 2 * hx, 2 * hz);
      ctx.fillStyle = '#efe2c0';
      ctx.fillRect(a.x - hx + 2, a.y - hz + 1, 2 * hx - 4, 2 * hz - 2);
      const text = String(n.node.number);
      drawText(ctx, text, a.x - Math.floor(textWidth(text) / 2), a.y - 2, '#7a1c16');
    } else {
      ellipse(ctx, a.x, a.y + 2, 16, 16, '#4a4036');
      ellipse(ctx, a.x, a.y + 1, 16, 16, '#9d917c');
      ellipse(ctx, a.x, a.y, 14, 14, '#b3a78f');
    }
  }
  return { canvas, left, top, nx, nz, x0, z0, levels, water, trees: placeTrees(layout, grid) };
}

export const TOP_LOOK: Look = {
  art,
  levelPx: 0,
  hopPx: 14,
  squash: 1,
  terrain: buildTerrain,
  castle: topCastle,
  knight: topKnight,
  tree: topTree,
  knightHeight: TOP_FIGURE_HEIGHT,
  across: (dx) => ({ x: dx, z: 0 }),
  front: { x: 0, z: 0.75 },
  figure: (f) => ({ x: f.x, z: f.z }),
  rings: { path: 10, start: 15, castle: 17 },
  hit: { castle: { hw: 15, up: 20, down: 16 }, marker: [10, 10], start: [14, 9] },
  castleLabel: 24,
  shield: { x: 16, y: -22 },
  popup: { castle: 32, other: 20 },
  badge: 4,
};
