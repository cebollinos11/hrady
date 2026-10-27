import type { Layout, Point } from '../layout';
import type { Ctx } from './sprites';

/** Small pixel-drawing helpers shared by the board views. */

export function hash(a: number, b: number, salt = 0): number {
  let h =
    Math.imul(a + 101, 374761393) ^ Math.imul(b + 57, 668265263) ^ Math.imul(salt + 7, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, colour: string) {
  ctx.fillStyle = colour;
  let [x, y] = [x0, y0];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x, y, 1, 1);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** A filled ellipse, one rectangle per row. */
export function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, colour: string) {
  ctx.fillStyle = colour;
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
    ctx.fillRect(cx - w, cy + dy, 2 * w + 1, 1);
  }
}

/** An ellipse outline `thick` pixels wide. */
export function ring(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  colour: string,
  thick = 1,
) {
  ctx.fillStyle = colour;
  const steps = Math.ceil(rx * 8);
  for (let t = 0; t < thick; t++)
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      ctx.fillRect(
        Math.round(cx + (rx - t) * Math.cos(a)),
        Math.round(cy + (ry - t * 0.5) * Math.sin(a)),
        1,
        1,
      );
    }
}

/** Dotted paths, entrance arrows, markers, start scrolls and castle bases. */

/**
 * The dotted paths and the arrowheads at castle entrances, flat on the
 * ground. `onGround` gives the art position of a world point and `art` the
 * projection, to turn an arrow's heading into a screen direction.
 */
export function drawPaths(
  ctx: Ctx,
  layout: Layout,
  onGround: (p: Point) => { x: number; y: number },
  art: (p: Point) => { x: number; y: number },
) {
  const dot = (p: Point) => {
    const a = onGround(p);
    ctx.fillStyle = '#5b4a2e';
    ctx.fillRect(a.x - 1, a.y + 1, 2, 1);
    ctx.fillStyle = '#f1e6c4';
    ctx.fillRect(a.x - 1, a.y, 2, 1);
  };
  for (const e of layout.edges) for (const p of e.dots) dot(p);
  for (const e of layout.entrances) {
    for (const p of e.dots) dot(p);
    const a = onGround(e.pos);
    // The arrowhead points at the castle: its screen direction from the world heading.
    const dir = art({ x: Math.sin(e.angle) * 10, z: Math.cos(e.angle) * 10 });
    const len = Math.hypot(dir.x, dir.y) || 1;
    const ux = dir.x / len;
    const uy = dir.y / len;
    const tip = { x: Math.round(a.x + ux * 4), y: Math.round(a.y + uy * 4) };
    const tail = { x: Math.round(a.x - ux * 3), y: Math.round(a.y - uy * 3) };
    line(ctx, tail.x, tail.y + 1, tip.x, tip.y + 1, '#5b4a2e');
    line(ctx, tail.x, tail.y, tip.x, tip.y, '#e8c25a');
    for (const s of [-1, 1])
      line(
        ctx,
        tip.x,
        tip.y,
        Math.round(tip.x - ux * 3 - uy * 2 * s),
        Math.round(tip.y - uy * 3 + ux * 2 * s),
        '#e8c25a',
      );
  }
}
