import type { FigureSize } from '../figures';
import { drawText, textWidth } from './font';
import { INK, build, darken, fromMap, lighten, type Sprite } from './sprites';

/**
 * Sprites for the top-down view: seen from above with a little of the front,
 * like the classic 16-bit adventure games. Anchors are at the middle of what
 * stands on the ground.
 */

const WALL = '#cfc3ad';
const WALL_LIGHT = '#e3d9c0';
const WALL_SHADE = '#8a7f6c';
const ROOF_NEUTRAL = '#6d7684';

const castles = new Map<string, Sprite>();

/** A castle seen from above: courtyard, four towers, a keep with the value on it. */
export function topCastle(colour: string | null, value: number): Sprite {
  const key = `${colour}|${value}`;
  let s = castles.get(key);
  if (s) return s;
  const roof = colour ?? ROOF_NEUTRAL;
  s = build(
    28,
    30,
    [14, 15],
    (ctx) => {
      const rect = (x: number, y: number, w: number, h: number, c: string) => {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, w, h);
      };
      // The shadow on the ground below the castle, like the one under a marker.
      rect(3, 28, 24, 2, '#4a4036');
      // Walls, lit from above: the top, and the front face below it with the gate.
      rect(2, 22, 24, 6, WALL_SHADE);
      rect(2, 22, 24, 1, WALL);
      rect(2, 27, 24, 1, darken(WALL_SHADE, 0.25));
      rect(2, 3, 24, 19, WALL);
      rect(2, 3, 24, 1, WALL_LIGHT);
      rect(25, 4, 1, 18, WALL_SHADE);
      rect(5, 6, 18, 13, WALL_LIGHT);
      rect(5, 6, 18, 1, lighten(WALL_LIGHT, 0.4));
      rect(5, 18, 18, 1, WALL);
      for (let x = 2; x < 26; x += 3) rect(x, 3, 2, 1, WALL_SHADE);
      rect(12, 22, 4, 6, INK);
      rect(13, 21, 2, 1, INK);
      // Towers on the corners: a roof on a shaded base.
      for (const [x, y] of [
        [0, 1],
        [21, 1],
        [0, 19],
        [21, 19],
      ] as const) {
        rect(x, y + 6, 7, 3, WALL_SHADE);
        rect(x, y + 8, 7, 1, darken(WALL_SHADE, 0.25));
        rect(x, y, 7, 7, darken(roof, 0.25));
        rect(x + 1, y + 1, 5, 5, roof);
        rect(x + 1, y + 1, 5, 2, lighten(roof, 0.25));
        rect(x, y, 7, 1, lighten(roof, 0.1));
        rect(x + 1, y + 5, 5, 1, darken(roof, 0.15));
        rect(x + 3, y + 3, 1, 1, '#ffffff');
      }
      // The keep, with the castle's value on a plaque.
      rect(9, 10, 10, 3, WALL_SHADE);
      rect(8, 7, 12, 9, darken(roof, 0.25));
      rect(9, 8, 10, 7, roof);
      rect(9, 8, 10, 3, lighten(roof, 0.2));
      rect(8, 7, 12, 1, roof);
      rect(9, 14, 10, 1, darken(roof, 0.15));
      const text = String(value);
      const w = textWidth(text) + 2;
      rect(14 - Math.floor(w / 2), 9, w, 7, '#7a1c16');
      drawText(ctx, text, 15 - Math.floor(w / 2), 10, '#ffe9a8');
      // A banner on a pole above the keep.
      rect(19, 1, 1, 8, '#4a3a2a');
      rect(20, 1, 5, 3, colour ?? '#ffffff');
      rect(20, 3, 4, 1, darken(colour ?? '#ffffff', 0.25));
    },
    null,
  );
  castles.set(key, s);
  return s;
}

const MAPS: Record<FigureSize, string[]> = {
  1: [
    '..mmm..',
    '.mmmmm.',
    '.msssm.',
    '..mmm.b',
    '.cccc.b',
    'wccccdb',
    'wlcccdb',
    'wwcddd.',
    '.cddd..',
    '.k...k.',
  ],
  2: [
    '...mmm...',
    '..mmmmm..',
    '..msssm.b',
    '...mmm..b',
    '..ccccc.b',
    'wwcccccdb',
    'wlwcccddb',
    'wllwcdd.b',
    'wwwcddd..',
    '..cdddd..',
    '..kk.kk..',
  ],
  5: [
    '....mmm....',
    '...mmmmm...',
    '...msssm..b',
    '....mmm...b',
    '..ccccccc.b',
    '.cccccccdd.',
    'wwcccccddb.',
    'wlwbbbbwdb.',
    'wwwbbbbbbb.',
    '.bbBbbbBbb.',
    '.bbbbbbbbb.',
    '..bbbbbbb..',
    '...bhhhb...',
    '...hhhhh...',
    '...hHhHh...',
    '....hhh....',
  ],
};

export const TOP_FIGURE_HEIGHT: Record<FigureSize, number> = { 1: 10, 2: 11, 5: 16 };

const knights = new Map<string, Sprite>();

export function topKnight(size: FigureSize, colour: string): Sprite {
  const key = `${size}|${colour}`;
  let s = knights.get(key);
  if (s) return s;
  const map = MAPS[size];
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
