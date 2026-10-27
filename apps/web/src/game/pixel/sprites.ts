import type { FigureSize } from '../figures';
import { drawOutlined, drawText, textWidth } from './font';

/**
 * Pixel-art sprites for the isometric view, drawn from code (nothing to load):
 * castles, knights, trees and the shield and count tokens. Every sprite is
 * built once per variant and cached; `INK` outlines them.
 */

export const INK = '#1b1410';

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Where the sprite's anchor (the middle of its feet) is in the canvas. */
  ox: number;
  oy: number;
}

export type Ctx = CanvasRenderingContext2D;

// --- Colours ----------------------------------------------------------------------

export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** `colour` mixed with `with` (a hex) by `t` (0..1). */
export function mix(colour: string, other: string, t: number): string {
  const a = rgb(colour);
  const b = rgb(other);
  return hex(a.map((v, i) => v + (b[i]! - v) * t));
}

export const darken = (colour: string, t: number) => mix(colour, '#000000', t);
export const lighten = (colour: string, t: number) => mix(colour, '#ffffff', t);

// --- Drawing helpers --------------------------------------------------------------

export function canvasOf(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return [canvas, ctx];
}

/** A filled diamond (a flat square seen from the isometric angle), `hw` wide each way. */
export function diamond(ctx: Ctx, x: number, y: number, hw: number, colour: string, hh = hw / 2) {
  ctx.fillStyle = colour;
  const rows = Math.ceil(hh);
  for (let k = -rows; k < rows; k++) {
    const w = Math.round(hw * (1 - Math.abs(k + 0.5) / hh));
    if (w > 0) ctx.fillRect(x - w, y + k, 2 * w, 1);
  }
}

/**
 * A box standing on the ground with its footprint's centre at (x, y): `hw` is
 * half its screen width, `h` its height. Left face dark, right face lighter.
 */
export function isoBox(
  ctx: Ctx,
  x: number,
  y: number,
  hw: number,
  h: number,
  colours: { top: string; left: string; right: string },
) {
  for (let dx = -hw; dx < 0; dx++) {
    ctx.fillStyle = colours.left;
    const by = y + Math.floor((hw + dx + 1) / 2);
    ctx.fillRect(x + dx, by - h, 1, h);
  }
  for (let dx = 0; dx < hw; dx++) {
    ctx.fillStyle = colours.right;
    const by = y + Math.floor((hw - dx) / 2);
    ctx.fillRect(x + dx, by - h, 1, h);
  }
  diamond(ctx, x, y - h, hw, colours.top);
}

/** A pyramid roof with its base centred on (x, y), `hw` wide each way and `h` tall. */
export function roof(ctx: Ctx, x: number, y: number, hw: number, h: number, colour: string) {
  for (let i = 0; i < h; i++) {
    const w = Math.max(1, Math.round(hw * (i / h)));
    const row = y - h + 1 + i;
    ctx.fillStyle = darken(colour, 0.25);
    ctx.fillRect(x - w, row, w, 1);
    ctx.fillStyle = colour;
    ctx.fillRect(x, row, w, 1);
  }
}

/** Surrounds the opaque pixels of `canvas` with a one-pixel `colour` line, in place. */
export function outline(canvas: HTMLCanvasElement, colour = INK) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { width: w, height: h } = canvas;
  const src = ctx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  out.data.set(src.data);
  const [r, g, b] = rgb(colour);
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && src.data[(y * w + x) * 4 + 3]! > 8;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        const i = (y * w + x) * 4;
        out.data[i] = r;
        out.data[i + 1] = g;
        out.data[i + 2] = b;
        out.data[i + 3] = 255;
      }
    }
  ctx.putImageData(out, 0, 0);
}

/** A sprite drawn by `draw` in a `w` × `h` canvas with room for the outline all round. */
export function build(
  w: number,
  h: number,
  anchor: [number, number],
  draw: (ctx: Ctx) => void,
  line = INK,
): Sprite {
  const [canvas, ctx] = canvasOf(w + 2, h + 2);
  ctx.translate(1, 1);
  draw(ctx);
  outline(canvas, line);
  return { canvas, ox: anchor[0] + 1, oy: anchor[1] + 1 };
}

/** A sprite from a character map; `palette` gives each character's colour. */
export function fromMap(
  rows: string[],
  palette: Record<string, string>,
  anchor: [number, number],
): Sprite {
  return build(rows[0]!.length, rows.length, anchor, (ctx) => {
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const colour = palette[ch];
        if (!colour) return;
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, 1, 1);
      }),
    );
  });
}

// --- Castles ----------------------------------------------------------------------

const STONE = { top: '#e3d9c0', left: '#9d917c', right: '#c9bda5' };
const STONE_DARK = { top: '#cfc3ad', left: '#8a7f6c', right: '#b3a78f' };
export const NEUTRAL_ROOF = '#6d7684';

const castles = new Map<string, Sprite>();

/** A castle of `value` swords with roofs and banner in `colour` (`null` is neutral). */
export function castleSprite(colour: string | null, value: number): Sprite {
  const key = `${colour}|${value}`;
  let s = castles.get(key);
  if (s) return s;
  const roofColour = colour ?? NEUTRAL_ROOF;
  const W = 14;
  s = build(2 * W + 2, 54, [W + 1, 46], (ctx) => {
    const x = W + 1;
    const y = 46;
    const tower = (tx: number, ty: number) => {
      isoBox(ctx, tx, ty, 3, 13, STONE_DARK);
      roof(ctx, tx, ty - 13, 4, 6, roofColour);
    };
    tower(x, y - 6); // the far corner
    isoBox(ctx, x, y, 11, 7, STONE);
    // Gate and arrow slits on the two faces.
    ctx.fillStyle = INK;
    ctx.fillRect(x + 4, y - 7, 3, 5);
    ctx.fillRect(x + 5, y - 8, 1, 1);
    ctx.fillRect(x - 6, y - 5, 1, 2);
    ctx.fillRect(x - 3, y - 3, 1, 2);
    // Keep on top of the wall.
    isoBox(ctx, x, y - 7, 5, 12, STONE);
    roof(ctx, x, y - 19, 7, 9, roofColour);
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(x, y - 33, 1, 6);
    ctx.fillStyle = colour ?? '#ffffff';
    ctx.fillRect(x + 1, y - 33, 5, 3);
    ctx.fillStyle = darken(colour ?? '#ffffff', 0.25);
    ctx.fillRect(x + 1, y - 31, 4, 1);
    tower(x - 11, y); // left, right, front
    tower(x + 11, y);
    tower(x, y + 6);
    // The castle's value on a plaque on the right-hand face of the keep.
    const text = String(value);
    const pw = textWidth(text) + 2;
    ctx.fillStyle = '#7a1c16';
    ctx.fillRect(x + 6, y - 12, pw, 7);
    drawText(ctx, text, x + 7, y - 11, '#ffe9a8');
  });
  castles.set(key, s);
  return s;
}

// --- Knights ----------------------------------------------------------------------

const KNIGHT_MAPS: Record<FigureSize, string[]> = {
  1: [
    'm..mm..',
    'b.mmmm.',
    'b.mssm.',
    'b..mm..',
    'b.cccc.',
    'bcccccd',
    'b.cccdd',
    '..ccdd.',
    '..ddd..',
    '..k.k..',
    '..k.k..',
  ],
  2: [
    'm...mm...',
    'b..mmmm..',
    'b..mssm..',
    'b...mm...',
    'b.cccccc.',
    'bwwcccccd',
    'bwlwcccdd',
    'bwlwcccdd',
    '.wwcccdd.',
    '...ddd...',
    '...ddd...',
    '...k.k...',
    '...k.k...',
  ],
  5: [
    '..........m..',
    '..........b..',
    '.....mm...b..',
    '....mmmm..b..',
    '....mssm..b..',
    '.....cc...b.h',
    '...cccccd.bhh',
    '..cccccddd.hh',
    '.bbbbbbbbbbbh',
    'bBbbbbbbbbbbh',
    'bBbbbbbbbbbH.',
    '.k.k....k.k..',
    '.k.k....k.k..',
  ],
};

export const FIGURE_SPRITE_HEIGHT: Record<FigureSize, number> = { 1: 11, 2: 13, 5: 13 };

const knights = new Map<string, Sprite>();

/** A knight figure in `colour`, anchored between its feet. */
export function knightSprite(size: FigureSize, colour: string): Sprite {
  const key = `${size}|${colour}`;
  let s = knights.get(key);
  if (s) return s;
  const map = KNIGHT_MAPS[size];
  s = fromMap(
    map,
    {
      m: '#c9ccd2',
      s: '#f0c8a0',
      b: '#7a5230',
      B: '#4e3320',
      h: '#9a6a3c',
      H: '#6a4524',
      k: '#2a2a2e',
      c: colour,
      d: darken(colour, 0.35),
      l: lighten(colour, 0.35),
      w: '#f4efe0',
    },
    [Math.floor(map[0]!.length / 2), map.length - 1],
  );
  knights.set(key, s);
  return s;
}

// --- Trees ------------------------------------------------------------------------

const trees: Sprite[] = [];

/** One of two pine/oak sprites, anchored at the trunk's foot. */
export function treeSprite(kind: number): Sprite {
  const i = kind % 2;
  if (trees[i]) return trees[i]!;
  trees[i] =
    i === 0
      ? build(11, 18, [5, 17], (ctx) => {
          ctx.fillStyle = '#5a3d22';
          ctx.fillRect(5, 14, 2, 4);
          const layers: [number, number][] = [
            [5, 0],
            [4, 4],
            [3, 8],
          ];
          layers.forEach(([hw], l) => {
            const top = l * 4;
            for (let r = 0; r < 6; r++) {
              const w = Math.min(5, Math.round(((r + 1) / 6) * (hw + l + 1)));
              ctx.fillStyle = '#2f6b34';
              ctx.fillRect(5 - w, top + r, w, 1);
              ctx.fillStyle = '#3f8a43';
              ctx.fillRect(5, top + r, w, 1);
            }
          });
        })
      : build(11, 16, [5, 15], (ctx) => {
          ctx.fillStyle = '#5a3d22';
          ctx.fillRect(5, 11, 2, 5);
          ctx.fillStyle = '#356f2f';
          ctx.fillRect(1, 3, 10, 7);
          ctx.fillRect(3, 1, 6, 11);
          ctx.fillStyle = '#4c9a43';
          ctx.fillRect(3, 2, 4, 3);
          ctx.fillRect(2, 5, 3, 2);
        });
  return trees[i]!;
}

// --- Tokens -----------------------------------------------------------------------

/** A count badge centred on (x, y): the number on a plate in the player's colour. */
export function drawBadge(ctx: Ctx, x: number, y: number, count: number, colour: string) {
  const text = String(count);
  const w = textWidth(text) + 3;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - Math.floor(w / 2) - 1, y - 4, w + 2, 9);
  ctx.fillStyle = colour;
  ctx.fillRect(x - Math.floor(w / 2), y - 3, w, 7);
  drawText(ctx, text, x - Math.floor(w / 2) + 1, y - 2, '#ffffff');
}

/** A heater shield with its top-left at (x, y): `text` on the owner's colour or on parchment. */
export function drawShield(
  ctx: Ctx,
  x: number,
  y: number,
  colour: string,
  text: string,
  revealed: boolean,
) {
  const w = Math.max(11, textWidth(text) + 5);
  const fill = revealed ? '#efe2c0' : colour;
  ctx.fillStyle = INK;
  ctx.fillRect(x, y, w, 12);
  ctx.fillRect(x + 1, y + 12, w - 2, 1);
  ctx.fillRect(x + 3, y + 13, w - 6, 1);
  ctx.fillStyle = revealed ? colour : '#f4efe0';
  ctx.fillRect(x + 1, y + 1, w - 2, 11);
  ctx.fillRect(x + 2, y + 12, w - 4, 1);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 2, y + 2, w - 4, 9);
  ctx.fillRect(x + 3, y + 11, w - 6, 1);
  drawText(
    ctx,
    text,
    x + Math.floor((w - textWidth(text)) / 2),
    y + 4,
    revealed ? '#222222' : '#ffffff',
  );
}

/** Floating text (popups, costs). */
export function drawLabel(ctx: Ctx, text: string, cx: number, y: number, colour: string) {
  drawOutlined(ctx, text, cx - Math.floor(textWidth(text) / 2), y, colour);
}
