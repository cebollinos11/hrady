import type { Board } from '@hrady/board';
import type { CastleView, PlayerId } from '@hrady/engine';
import type { Marks } from '../shared/marks';
import { NO_MARKS } from '../shared/marks';
import { PLAYER_COLOURS } from '../shared/describe';
import type { BoardView, Preset, ViewRig } from './boardView';
import { arrange, compose, startSlots, type FigureSize } from './figures';
import {
  START_SIZE,
  buildLayout,
  course,
  type Layout,
  type NodeLayout,
  type Point,
} from './layout';
import { TILE, type Look, type Terrain } from './look';
import { line, ring } from './pixel/draw';
import { drawText, textWidth } from './pixel/font';
import { INK, drawBadge, drawLabel, drawShield, type Ctx, type Sprite } from './pixel/sprites';
import type { Trail } from './recent';
import { pathLength, pointAt } from './route';
import type { Knights } from './steps';

/**
 * A pixel-art view of the board. Everything is drawn into a small canvas that
 * the browser scales up without smoothing, so one art pixel is a block of
 * screen pixels. The ground is drawn once; castles, knights and trees are
 * sprites sorted back to front each frame. A `Look` says how the world is
 * projected and drawn, the rest is the same.
 */

const SKY = '#1d2a1f';
const ZOOMS = [1, 1.5, 2, 3, 4, 5, 6];
const NEUTRAL = '#efe9dc';

const HIGHLIGHT = {
  selectable: '#ffffff',
  selected: '#fff27a',
  move: '#4ee06a',
  castle: '#ff9a2e',
  field: '#ff4b3e',
  source: '#5aa8ff',
  shield: '#ffd34a',
};

const colourOf = (p: number | null) => (p === null ? NEUTRAL : (PLAYER_COLOURS[p] ?? '#777777'));

// --- Camera -----------------------------------------------------------------------

/** What `go` is flying to: a zoom (set at once) and the art point at the middle of the view. */
class PixelRig implements ViewRig {
  insetTop = 0;
  private preset: Preset | null = null;
  private flight: { fromX: number; fromY: number; start: number } | null = null;

  constructor(private readonly view: PixelScene) {}

  get current() {
    return this.preset;
  }

  go(preset: Preset, focus: readonly Point[] = [], instant = false) {
    this.preset = preset;
    const target = this.view.framing(preset, focus);
    this.view.zoom = target.zoom;
    this.flight = instant
      ? null
      : { fromX: this.view.camX, fromY: this.view.camY, start: performance.now() };
    this.to = target;
    if (instant) this.view.lookAt(target.x, target.y);
  }

  private to = { x: 0, y: 0, zoom: 2 };

  /** Called when the user pans or zooms. */
  release() {
    this.preset = null;
    this.flight = null;
  }

  /** Re-fits a preset after a resize. */
  refit() {
    if (this.preset && this.preset !== 'focus') this.go(this.preset, [], true);
  }

  update(now: number) {
    if (!this.flight) return;
    const t = Math.min(1, (now - this.flight.start) / 450);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    this.view.lookAt(
      this.flight.fromX + (this.to.x - this.flight.fromX) * e,
      this.flight.fromY + (this.to.y - this.flight.fromY) * e,
    );
    if (t >= 1) this.flight = null;
  }
}

// --- The view ---------------------------------------------------------------------

interface Tween {
  start: number;
  duration: number;
  update: (t: number) => void;
  resolve: () => void;
}

/** Something drawn on top of the board for a moment. */
type Effect =
  | { kind: 'ring'; id: string; colour: string; t: number }
  | { kind: 'text'; id: string; text: string; colour: string; t: number }
  | { kind: 'shield'; id: string; colour: string; t: number }
  | { kind: 'walk'; player: PlayerId; count: number; x: number; z: number; y: number };

interface Drawable {
  depth: number;
  draw: (ctx: Ctx) => void;
}

export class PixelScene implements BoardView {
  readonly layout: Layout;
  readonly rig: PixelRig;
  private readonly ctx: Ctx;
  private readonly terrain: Terrain;
  private tweens: Tween[] = [];
  private effects = new Set<Effect>();
  private knights: Knights = {};
  private castles: Record<string, CastleView> = {};
  private marks: Marks = NO_MARKS;
  private trails: readonly Trail[] = [];
  private pings: readonly string[] = [];
  private labels = true;
  private trailsVisible = true;
  /** Vertical offset in art pixels of a stack that is dropping in, by `node:player`. */
  private lifts = new Map<string, number>();
  private now = 0;
  /** Art coordinates at the middle of the canvas, and pixels per art pixel. */
  camX = 0;
  camY = 0;
  zoom = 2;
  private width = 1;
  private height = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly board: Board,
    layout: Layout | undefined,
    private readonly look: Look,
  ) {
    this.layout = layout ?? buildLayout(board);
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.terrain = look.terrain(this.layout);
    this.rig = new PixelRig(this);
    this.attachControls();
  }

  // --- Camera -----------------------------------------------------------------

  private get bounds() {
    const t = this.terrain;
    return {
      left: t.left,
      top: t.top,
      right: t.left + t.canvas.width,
      bottom: t.top + t.canvas.height,
    };
  }

  /** Moves the middle of the view to an art point, keeping it over the board. */
  lookAt(x: number, y: number) {
    const b = this.bounds;
    this.camX = Math.max(b.left, Math.min(b.right, x));
    this.camY = Math.max(b.top, Math.min(b.bottom, y));
  }

  /** The zoom and middle point a preset gives, for the current canvas size. */
  framing(preset: Preset, focus: readonly Point[]) {
    const b = this.bounds;
    const inset = this.rig.insetTop;
    const cssW = this.canvas.clientWidth || 800;
    const cssH = Math.max(1, (this.canvas.clientHeight || 600) - inset);
    const fit = (w: number, h: number) => {
      let best = ZOOMS[0]!;
      for (const z of ZOOMS) if (w * z <= cssW && h * z <= cssH) best = z;
      return best;
    };
    // The overview fills the free space as far as the board's shape allows; the rest is letterbox.
    const [bw, bh] = [b.right - b.left + 12, b.bottom - b.top + 12];
    const overview = Math.max(ZOOMS[0]!, Math.min(ZOOMS.at(-1)!, cssW / bw, cssH / bh));
    const at = (zoom: number, x: number, y: number) => ({ zoom, x, y: y - inset / (2 * zoom) });
    const mid = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
    const step = (z: number, n: number) => {
      const above = ZOOMS.filter((v) => v > z + 1e-6);
      return above[Math.min(above.length, n) - 1] ?? ZOOMS.at(-1)!;
    };
    if (preset === 'overview') return at(overview, mid.x, mid.y);
    if (preset === 'table') return at(step(overview, 1), mid.x, mid.y);
    if (!focus.length) return at(step(overview, 2), mid.x, mid.y);
    const pts = focus.map((p) => this.look.art(p));
    const [x0, x1] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
    const [y0, y1] = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
    const zoom = Math.min(4, Math.max(overview, fit(x1 - x0 + 90, y1 - y0 + 110)));
    return at(zoom, (x0 + x1) / 2, (y0 + y1) / 2 - 10);
  }

  private setZoom(zoom: number, anchor?: { x: number; y: number }) {
    zoom = Math.max(ZOOMS[0]!, Math.min(ZOOMS.at(-1)!, zoom));
    if (zoom === this.zoom) return;
    // Keep the art point under the cursor where it is.
    const rect = this.canvas.getBoundingClientRect();
    const ax = anchor ? anchor.x - rect.left - rect.width / 2 : 0;
    const ay = anchor ? anchor.y - rect.top - rect.height / 2 : 0;
    const under = { x: this.camX + ax / this.zoom, y: this.camY + ay / this.zoom };
    this.zoom = zoom;
    this.lookAt(under.x - ax / zoom, under.y - ay / zoom);
    this.resize();
    this.rig.release();
  }

  private stepZoom(dir: number, anchor?: { x: number; y: number }) {
    const i = ZOOMS.findIndex((z) => z >= this.zoom - 1e-6);
    this.setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))]!, anchor);
  }

  private attachControls() {
    const c = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    c.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.setPointerCapture(e.pointerId);
      pinch = 0;
    });
    c.addEventListener('pointermove', (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        if (Math.hypot(e.clientX - last.x, e.clientY - last.y) === 0) return;
        this.lookAt(
          this.camX - (e.clientX - last.x) / this.zoom,
          this.camY - (e.clientY - last.y) / this.zoom,
        );
        this.rig.release();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (!pinch) pinch = d;
        else if (d > pinch * 1.4 || d < pinch / 1.4) {
          this.stepZoom(d > pinch ? 1 : -1, { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 });
          pinch = d;
        }
      }
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    let wheel = 0;
    let last = 0;
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        wheel += e.deltaY;
        if (Math.abs(wheel) < 40 || e.timeStamp - last < 120) return;
        this.stepZoom(wheel < 0 ? 1 : -1, { x: e.clientX, y: e.clientY });
        wheel = 0;
        last = e.timeStamp;
      },
      { passive: false },
    );
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.width = Math.max(1, Math.ceil(w / this.zoom));
    this.height = Math.max(1, Math.ceil(h / this.zoom));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx.imageSmoothingEnabled = false;
    this.rig.refit();
  }

  // --- Positions ------------------------------------------------------------------

  private node(id: string): NodeLayout {
    const n = this.layout.nodes.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    return n;
  }

  /** Ground height in world units at a point. */
  private levelAt(p: Point): number {
    const t = this.terrain;
    const i = Math.floor((p.x - t.x0) / TILE);
    const j = Math.floor((p.z - t.z0) / TILE);
    if (i < 0 || j < 0 || i >= t.nx || j >= t.nz) return 0;
    return Math.max(0, t.levels[j * t.nx + i]!);
  }

  /** Art position of a world point standing on the ground. */
  private ground(p: Point, y = 0) {
    const a = this.look.art(p);
    return {
      x: a.x,
      y: a.y - Math.round(this.levelAt(p) * this.look.levelPx) - Math.round(y * this.look.hopPx),
    };
  }

  /** Where `player`'s knights stand on a node, given the knights there. */
  private standPoint(id: string, player: PlayerId, knights: Knights = this.knights): Point {
    const n = this.node(id);
    const { pos } = n;
    if (n.node.type === 'path') return pos;
    // Side by side across the screen.
    const side = (dx: number) => {
      const o = this.look.across(dx);
      return { x: pos.x + o.x, z: pos.z + o.z };
    };
    if (n.node.type === 'start') {
      const present = (knights[id] ?? []).flatMap((c, p) => (c > 0 || p === player ? [p] : []));
      const slot = startSlots(present, START_SIZE.width).get(player) ?? { x: 0, z: 0 };
      const at = side(slot.x * 1.4);
      return { x: at.x + 0.05, z: at.z + 0.05 };
    }
    // In front of the castle's gate tower.
    const present = (knights[id] ?? []).flatMap((c, p) => (c > 0 || p === player ? [p] : []));
    const slot = startSlots(present, 1.2).get(player) ?? { x: 0, z: 0 };
    const at = side(slot.x);
    return { x: at.x + this.look.front.x, z: at.z + this.look.front.z };
  }

  private spacing(id: string, players: number): number {
    const type = this.node(id).node.type;
    if (type === 'start') return players > 2 ? 0.2 : 0.26;
    if (type === 'castle') return 0.26;
    return 0.3;
  }

  // --- State ------------------------------------------------------------------------

  setLabels(visible: boolean) {
    this.labels = visible;
  }
  setTrailsVisible(visible: boolean) {
    this.trailsVisible = visible;
  }
  showKnights(knights: Knights) {
    this.knights = knights;
  }
  showCastles(castles: Record<string, CastleView>) {
    this.castles = castles;
  }
  showMarks(marks: Marks) {
    this.marks = marks;
  }
  showTrails(trails: readonly Trail[]) {
    this.trails = trails.filter(
      (t) => this.layout.nodes.has(t.from) && this.layout.nodes.has(t.to),
    );
  }
  showPings(ids: readonly string[]) {
    this.pings = ids.filter((id) => this.layout.nodes.has(id));
  }
  colour(player: PlayerId | null) {
    return colourOf(player);
  }
  nodePoint(id: string): Point {
    return this.node(id).pos;
  }

  // --- Picking ----------------------------------------------------------------------

  private toClient(a: { x: number; y: number }) {
    const rect = this.canvas.getBoundingClientRect();
    const k = rect.width / this.width;
    const kv = rect.height / this.height;
    return {
      x: rect.left + (a.x - this.camX + this.width / 2) * k,
      y: rect.top + (a.y - this.camY + this.height / 2) * kv,
    };
  }

  private toArt(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: this.camX - this.width / 2 + ((clientX - rect.left) / rect.width) * this.width,
      y: this.camY - this.height / 2 + ((clientY - rect.top) / rect.height) * this.height,
    };
  }

  pick(clientX: number, clientY: number): string | null {
    const p = this.toArt(clientX, clientY);
    let best: { id: string; score: number } | null = null;
    for (const n of this.layout.nodes.values()) {
      const a = this.ground(n.pos);
      let score: number;
      if (n.node.type === 'castle') {
        // The whole castle sprite counts, the stack in front of it too.
        const { hw, up, down } = this.look.hit.castle;
        const inside = p.x >= a.x - hw && p.x <= a.x + hw && p.y >= a.y - up && p.y <= a.y + down;
        if (!inside) continue;
        score = Math.hypot(p.x - a.x, (p.y - a.y + 12) * 0.6) / 40;
      } else {
        const [rx, ry] = n.node.type === 'start' ? this.look.hit.start : this.look.hit.marker;
        // A knight standing on the marker reaches above it.
        score = Math.hypot((p.x - a.x) / rx, (p.y - a.y + ry * 0.45) / ry);
        if (score > 1) continue;
      }
      if (!best || score < best.score) best = { id: n.id, score };
    }
    return best?.id ?? null;
  }

  screenPoint(id: string): { x: number; y: number } {
    const n = this.node(id);
    const a = this.ground(n.pos);
    return this.toClient({ x: a.x, y: a.y - (n.node.type === 'castle' ? 24 : 8) });
  }

  // --- Animation primitives ----------------------------------------------------------

  private tween(duration: number, update: (t: number) => void): Promise<void> {
    if (duration <= 0) {
      update(1);
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.tweens.push({ start: performance.now(), duration, update, resolve }),
    );
  }

  finishTweens() {
    const tweens = this.tweens;
    this.tweens = [];
    for (const t of tweens) {
      t.update(1);
      t.resolve();
    }
  }

  async travel(
    player: PlayerId,
    from: string,
    to: string,
    count: number,
    duration: number,
    back = false,
  ) {
    const a = this.standPoint(from, player);
    const b = this.standPoint(to, player);
    const way = course(this.layout, from, to).map((p) => ({ ...p }));
    way[0] = a;
    way[way.length - 1] = b;
    const len = pathLength(way);
    const end = back ? len * 0.55 : len;
    const walker: Effect = { kind: 'walk', player, count, x: a.x, z: a.z, y: 0 };
    this.effects.add(walker);
    await this.tween(duration, (t) => {
      const s = back ? Math.sin(t * Math.PI) : t * t * (3 - 2 * t);
      const p = pointAt(way, s * end);
      walker.x = p.x;
      walker.z = p.z;
      // A little hop with every step.
      walker.y = Math.abs(Math.sin(s * end * 9)) * 0.05;
    });
    this.effects.delete(walker);
  }

  async burst(id: string, colour: string, duration: number) {
    const e: Effect = { kind: 'ring', id, colour, t: 0 };
    this.effects.add(e);
    await this.tween(duration, (t) => (e.t = t));
    this.effects.delete(e);
  }

  async popup(id: string, text: string, colour: string, duration: number) {
    const e: Effect = { kind: 'text', id, text, colour, t: 0 };
    this.effects.add(e);
    await this.tween(duration, (t) => (e.t = t));
    this.effects.delete(e);
  }

  async drop(id: string, player: PlayerId, duration: number) {
    const key = `${id}:${player}`;
    await this.tween(duration, (t) => this.lifts.set(key, Math.round((1 - t * t) * 40)));
    this.lifts.delete(key);
  }

  async dropShield(castleId: string, player: PlayerId, duration: number) {
    const e: Effect = { kind: 'shield', id: castleId, colour: colourOf(player), t: 0 };
    this.effects.add(e);
    await this.tween(duration, (t) => (e.t = t));
    this.effects.delete(e);
  }

  // --- Drawing ----------------------------------------------------------------------

  render(now: number, draw = true) {
    const running = this.tweens;
    this.tweens = [];
    for (const t of running) {
      const p = Math.min(1, (now - t.start) / t.duration);
      t.update(p);
      if (p < 1) this.tweens.push(t);
      else t.resolve();
    }
    this.rig.update(now);
    this.now = now;
    if (!draw || this.canvas.hidden) return;
    this.paint();
  }

  private paint() {
    const ctx = this.ctx;
    const ox = Math.round(this.width / 2 - this.camX);
    const oy = Math.round(this.height / 2 - this.camY);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = SKY;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.setTransform(1, 0, 0, 1, ox, oy);

    const t = this.terrain;
    ctx.drawImage(t.canvas, t.left, t.top);
    this.paintWater(ctx);
    this.paintGround(ctx);

    const things: Drawable[] = [];
    this.collectTrees(things, ox, oy);
    this.collectCastles(things);
    this.collectKnights(things);
    things.sort((a, b) => a.depth - b.depth);
    for (const d of things) d.draw(ctx);

    this.paintTop(ctx);
  }

  /** Glints that drift across the river. */
  private paintWater(ctx: Ctx) {
    const phase = this.now / 900;
    for (const w of this.terrain.water) {
      const x = Math.round(phase + w.phase * 9) % 9;
      if (x > 3) continue;
      ctx.fillStyle = x === 0 || x === 3 ? '#6aa6e0' : '#a9d0f2';
      ctx.fillRect(w.x - 4 + x * 2, w.y - 1 + (x % 2), x === 1 || x === 2 ? 3 : 1, 1);
    }
  }

  /** Rings round castle owners, highlights and pings, flat on the ground. */
  private paintGround(ctx: Ctx) {
    const blink = Math.floor(this.now / 330) % 2;
    for (const [id, c] of Object.entries(this.castles)) {
      if (c.owner === null || !this.layout.nodes.has(id)) continue;
      const a = this.ground(this.node(id).pos);
      const rx = this.look.rings.castle - 3;
      ring(ctx, a.x, a.y + 1, rx, rx * this.look.squash, colourOf(c.owner), 2);
    }
    const m = this.marks;
    const mark = (id: string, colour: string, thick = 2, pulse = false, grow = 0) => {
      const n = this.layout.nodes.get(id);
      if (!n) return;
      const a = this.ground(n.pos);
      const { path, start, castle } = this.look.rings;
      const rx = n.node.type === 'path' ? path : n.node.type === 'start' ? start : castle;
      const k = grow + (pulse ? blink : 0);
      ring(ctx, a.x, a.y + 1, rx + k, (rx + k) * this.look.squash, colour, thick);
    };
    for (const id of m.selectable) if (id !== m.selected) mark(id, HIGHLIGHT.selectable, 1);
    if (m.selected) mark(m.selected, HIGHLIGHT.selected, 2, false, 1);
    for (const id of m.moves) mark(id, HIGHLIGHT.move, 2, true);
    for (const id of m.castles) mark(id, HIGHLIGHT.castle, 2, true);
    for (const id of m.fields) mark(id, HIGHLIGHT.field, 2, true);
    if (m.target) mark(m.target, HIGHLIGHT.field, 3, true, 2);
    for (const [id, count] of m.sources) mark(id, HIGHLIGHT.source, count ? 2 : 1, !count);
    if (m.shield) mark(m.shield, HIGHLIGHT.shield, 3, true, 2);
    for (const id of this.pings) mark(id, '#ffffff', 2, true, 1);
  }

  private collectTrees(out: Drawable[], ox: number, oy: number) {
    const margin = 24;
    for (const tree of this.terrain.trees) {
      const a = this.ground(tree.p);
      const sx = a.x + ox;
      const sy = a.y + oy;
      if (sx < -margin || sy < -margin * 2 || sx > this.width + margin || sy > this.height + margin)
        continue;
      const s = this.look.tree(tree.kind);
      out.push({ depth: tree.p.x + tree.p.z, draw: (ctx) => blit(ctx, s, a.x, a.y) });
    }
  }

  private collectCastles(out: Drawable[]) {
    for (const n of this.layout.nodes.values()) {
      if (n.node.type !== 'castle') continue;
      const owner = this.castles[n.id]?.owner ?? null;
      const s = this.look.castle(owner === null ? null : colourOf(owner), n.node.value);
      const a = this.ground(n.pos);
      out.push({ depth: n.pos.x + n.pos.z, draw: (ctx) => blit(ctx, s, a.x, a.y) });
    }
  }

  /** Figures of `count` knights at a world point, back to front. */
  private figures(
    out: Drawable[],
    player: PlayerId,
    count: number,
    at: Point,
    spacing: number,
    lift: number,
    y = 0,
  ) {
    const colour = colourOf(player);
    for (const f of arrange(compose(count), spacing)) {
      const o = this.look.figure(f);
      const p = { x: at.x + o.x, z: at.z + o.z };
      const s = this.look.knight(f.size as FigureSize, colour);
      const a = this.ground(p, y);
      out.push({ depth: p.x + p.z + 0.01, draw: (ctx) => blit(ctx, s, a.x, a.y - lift) });
    }
  }

  private collectKnights(out: Drawable[]) {
    for (const [id, counts] of Object.entries(this.knights)) {
      if (!this.layout.nodes.has(id)) continue;
      const present = counts.filter((c) => c > 0).length;
      counts.forEach((c, player) => {
        if (!c) return;
        this.figures(
          out,
          player,
          c,
          this.standPoint(id, player),
          this.spacing(id, present),
          this.lifts.get(`${id}:${player}`) ?? 0,
        );
      });
    }
    for (const e of this.effects)
      if (e.kind === 'walk') this.figures(out, e.player, e.count, e, 0.3, 0, e.y);
  }

  /** Badges, shields, labels, trails and effects: always on top, never hidden by a castle. */
  private paintTop(ctx: Ctx) {
    if (this.trailsVisible) for (const t of this.trails) this.paintTrail(ctx, t);

    for (const [id, counts] of Object.entries(this.knights)) {
      if (!this.layout.nodes.has(id)) continue;
      counts.forEach((c, player) => {
        if (!c) return;
        const at = this.standPoint(id, player);
        const a = this.ground(at);
        const tallest = Math.max(...compose(c).map((s) => this.look.knightHeight[s]));
        const rows = compose(c).length > 1 ? 4 : 0;
        const lift = this.lifts.get(`${id}:${player}`) ?? 0;
        drawBadge(ctx, a.x, a.y - tallest - this.look.badge - rows - lift, c, colourOf(player));
      });
    }
    for (const e of this.effects) {
      if (e.kind !== 'walk') continue;
      const a = this.ground(e, e.y);
      drawBadge(ctx, a.x, a.y - 18, e.count, colourOf(e.player));
    }

    for (const [id, view] of Object.entries(this.castles)) {
      if (!view.shield || view.owner === null || !this.layout.nodes.has(id)) continue;
      const a = this.ground(this.node(id).pos);
      const s = view.shield;
      const text = s.revealed ? String(s.value ?? '?') : s.value === null ? '?' : `(${s.value})`;
      drawShield(
        ctx,
        a.x + this.look.shield.x,
        a.y + this.look.shield.y,
        colourOf(view.owner),
        text,
        s.revealed,
      );
    }

    if (this.labels)
      for (const n of this.layout.nodes.values()) {
        if (n.node.type !== 'castle') continue;
        const a = this.ground(n.pos);
        const w = textWidth(n.node.name) + 4;
        ctx.fillStyle = INK;
        ctx.fillRect(a.x - Math.floor(w / 2), a.y - this.look.castleLabel, w, 9);
        drawText(
          ctx,
          n.node.name,
          a.x - Math.floor(w / 2) + 2,
          a.y - this.look.castleLabel + 2,
          '#fff6e0',
        );
      }

    // The cost of targets more than one step away.
    for (const [id, cost] of this.marks.costs) {
      const n = this.layout.nodes.get(id);
      if (!n || cost < 2) continue;
      const colour = this.marks.castles.has(id) ? HIGHLIGHT.castle : HIGHLIGHT.move;
      const a = this.ground(n.pos);
      const x = a.x + (n.node.type === 'castle' ? 14 : 9);
      const y = a.y + 3;
      ctx.fillStyle = colour;
      ctx.fillRect(x - 3, y - 4, textWidth(String(cost)) + 5, 9);
      ctx.fillStyle = SKY;
      ctx.fillRect(x - 2, y - 3, textWidth(String(cost)) + 3, 7);
      drawText(ctx, String(cost), x, y - 2, '#ffffff');
    }

    for (const e of this.effects) this.paintEffect(ctx, e);
  }

  private paintEffect(ctx: Ctx, e: Effect) {
    if (e.kind === 'walk') return;
    const n = this.node(e.id);
    const a = this.ground(n.pos);
    if (e.kind === 'ring') {
      const grow = Math.round(e.t * 14);
      const rx = (n.node.type === 'castle' ? this.look.rings.castle : this.look.rings.path) - 2;
      const q = this.look.squash;
      if (e.t < 0.85) ring(ctx, a.x, a.y, rx + grow, (rx + grow) * q, e.colour, 2);
      if (e.t < 0.5) ring(ctx, a.x, a.y, rx + grow / 2, (rx + grow / 2) * q, '#ffffff', 1);
    } else if (e.kind === 'text') {
      const y =
        a.y -
        (n.node.type === 'castle' ? this.look.popup.castle : this.look.popup.other) -
        Math.round(e.t * 12);
      if (e.t < 0.9) drawLabel(ctx, e.text, a.x, y, e.colour);
    } else {
      const y = a.y + this.look.shield.y - Math.round((1 - e.t * e.t) * 50);
      drawShield(ctx, a.x + this.look.shield.x, y, e.colour, '', false);
    }
  }

  private paintTrail(ctx: Ctx, t: Trail) {
    const a = this.ground(this.standPoint(t.from, t.player));
    const b = this.ground(this.standPoint(t.to, t.player));
    const f = t.kind === 'lost' ? 0.6 : 0.82;
    const end = { x: Math.round(a.x + (b.x - a.x) * f), y: Math.round(a.y + (b.y - a.y) * f) };
    const lift = 8 + Math.hypot(end.x - a.x, end.y - a.y) * 0.18;
    const mid = { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2 - lift };
    const colour = colourOf(t.player);
    const steps = Math.max(8, Math.ceil(Math.hypot(end.x - a.x, end.y - a.y)));
    let prev = { x: a.x, y: a.y - 4 };
    let dir = { x: 0, y: 0 };
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const x = Math.round((1 - u) ** 2 * a.x + 2 * (1 - u) * u * mid.x + u * u * end.x);
      const y = Math.round(
        (1 - u) ** 2 * (a.y - 4) + 2 * (1 - u) * u * (mid.y - 4) + u * u * (end.y - 4),
      );
      // Moves are dashed, battles solid.
      if (t.kind !== 'move' || Math.floor(i / 3) % 2 === 0) {
        ctx.fillStyle = INK;
        ctx.fillRect(x, y + 1, 1, 1);
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, 1, 1);
      }
      dir = { x: x - prev.x, y: y - prev.y };
      prev = { x, y };
    }
    const len = Math.hypot(dir.x, dir.y) || 1;
    const ux = dir.x / len;
    const uy = dir.y / len;
    for (const s of [-1, 1]) {
      line(
        ctx,
        prev.x,
        prev.y,
        Math.round(prev.x - ux * 4 - uy * 3 * s),
        Math.round(prev.y - uy * 4 + ux * 3 * s),
        colour,
      );
    }
    if (t.kind === 'lost') {
      ctx.fillStyle = '#ff6b5e';
      for (const [dx, dy] of [
        [-2, -6],
        [2, -6],
        [-1, -5],
        [1, -5],
        [0, -4],
        [-1, -3],
        [1, -3],
        [-2, -2],
        [2, -2],
      ] as const)
        ctx.fillRect(prev.x + dx, prev.y + dy, 1, 1);
    }
  }
}

function blit(ctx: Ctx, s: Sprite, x: number, y: number) {
  ctx.drawImage(s.canvas, x - s.ox, y - s.oy);
}
