import type { Board, BoardNode } from '@hrady/board';
import type { CastleView, PlayerId } from '@hrady/engine';
import { PLAYER_COLOURS } from '../shared/describe';
import { HIGHLIGHT, NO_MARKS, type Marks } from '../shared/marks';
import type { BoardView, Preset, ViewRig } from './boardView';
import type { Point } from './layout';
import type { Trail } from './recent';
import type { Knights } from './steps';

/**
 * A schematic view of the board: the graph itself, with markers, start areas
 * and castles as flat shapes and knights as numbered discs. It draws on the
 * same canvas as the pixel-art view and answers the same `BoardView` calls, so
 * the game client does not care which one is showing. Positions are the board's
 * own image coordinates; `Point.z` is the vertical axis.
 */

const GROUND = '#5d7f4e';
const NEUTRAL = '#b7ab95';
const INK = '#2b2a26';
/** Board units kept free round the nodes when fitting the view. */
const MARGIN = 70;
/** How much bigger nodes, castles and stacks are drawn than the board's own proportions. */
const G = 1.6;
/** Largest side of the cached board layer, in device pixels. */
const MAX_LAYER = 4096;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
/** How long a walk of one typical step (the length of an edge) takes its nominal duration. */
const WALK_REFERENCE = 120;
const SHIELD_PATH = new Path2D('M-8,-9 h16 v7 q0,9 -8,13 q-8,-4 -8,-13 z');

const colourOf = (p: number | null) => (p === null ? NEUTRAL : (PLAYER_COLOURS[p] ?? '#777777'));
const dpr = () => Math.max(1, window.devicePixelRatio || 1);

interface Tween {
  start: number;
  duration: number;
  update: (t: number) => void;
  resolve: () => void;
}

type Effect =
  | { kind: 'ring'; id: string; colour: string; t: number }
  | { kind: 'text'; id: string; text: string; colour: string; t: number }
  | { kind: 'shield'; id: string; colour: string; t: number }
  | { kind: 'walk'; player: PlayerId; count: number; x: number; y: number; hop: number }
  | { kind: 'pulse'; id: string; colour: string; t: number }
  | { kind: 'reject'; id: string; player: PlayerId; t: number }
  | { kind: 'dust'; id: string; colour: string; t: number; big: boolean }
  | { kind: 'sparks'; id: string; t: number }
  | { kind: 'fall'; player: PlayerId; count: number; x: number; y: number; t: number }
  | {
      kind: 'reveal';
      id: string;
      colour: string;
      value: number;
      label: string;
      labelColour: string;
      mode: 'flip' | 'settle' | 'shatter';
      t: number;
    };

interface Frame {
  zoom: number;
  x: number;
  y: number;
}

class GraphRig implements ViewRig {
  insetTop = 0;
  private preset: Preset | null = null;
  private flight: { from: Frame; to: Frame; start: number } | null = null;

  constructor(private readonly view: GraphScene) {}

  get current() {
    return this.preset;
  }

  go(preset: Preset, focus: readonly Point[] = [], instant = false) {
    this.preset = preset;
    const to = this.view.framing(preset, focus);
    const from = this.view.frame;
    this.flight = instant ? null : { from, to, start: performance.now() };
    if (instant) this.view.frame = to;
  }

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
    const f = this.flight;
    if (!f) return;
    const t = Math.min(1, (now - f.start) / 450);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const mix = (a: number, b: number) => a + (b - a) * e;
    this.view.frame = {
      zoom: mix(f.from.zoom, f.to.zoom),
      x: mix(f.from.x, f.to.x),
      y: mix(f.from.y, f.to.y),
    };
    if (t >= 1) this.flight = null;
  }
}

export class GraphScene implements BoardView {
  readonly rig: GraphRig;
  /** Board units at the middle of the view, and screen pixels per board unit. */
  frame: Frame = { zoom: 1, x: 0, y: 0 };
  /** Whether this view is the one on the canvas; the other one ignores the pointer. */
  enabled = false;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: { width: number; height: number };
  /** Node positions in board units. */
  private readonly at = new Map<string, Point>();
  private readonly bounds: { x0: number; y0: number; x1: number; y1: number };
  private tweens: Tween[] = [];
  private effects = new Set<Effect>();
  private knights: Knights = {};
  private castles: Record<string, CastleView> = {};
  private marks: Marks = NO_MARKS;
  private trails: readonly Trail[] = [];
  private pings: readonly string[] = [];
  private labels = true;
  private trailsVisible = true;
  private ghost: { id: string; player: PlayerId } | null = null;
  /** Height in board units of a stack that is dropping in, by `node:player`. */
  private lifts = new Map<string, number>();
  private now = 0;
  private shakeX = 0;
  private shakeY = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly board: Board,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.size = board.data.image ?? { width: 876, height: 1200 };
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const n of board.data.nodes) {
      const p = { x: n.x * this.size.width, z: n.y * this.size.height };
      this.at.set(n.id, p);
      [x0, y0, x1, y1] = [
        Math.min(x0, p.x),
        Math.min(y0, p.z),
        Math.max(x1, p.x),
        Math.max(y1, p.z),
      ];
    }
    this.bounds = { x0: x0 - MARGIN, y0: y0 - MARGIN, x1: x1 + MARGIN, y1: y1 + MARGIN };
    this.rig = new GraphRig(this);
    this.attachControls();
  }

  // --- Camera -----------------------------------------------------------------

  /** The frame a preset gives, for the current canvas size. */
  framing(preset: Preset, focus: readonly Point[]): Frame {
    const b = this.bounds;
    const inset = this.rig.insetTop;
    const w = this.canvas.clientWidth || 800;
    const h = Math.max(1, (this.canvas.clientHeight || 600) - inset);
    const fit = (x0: number, y0: number, x1: number, y1: number) =>
      Math.min(w / (x1 - x0), h / (y1 - y0));
    // The view's middle is below the toolbar: shift the board's middle up by half of it.
    const at = (zoom: number, x: number, y: number): Frame => ({
      zoom,
      x,
      y: y - inset / (2 * zoom),
    });
    const overview = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit(b.x0, b.y0, b.x1, b.y1)));
    const mid = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    if (preset === 'overview') return at(overview, mid.x, mid.y);
    if (preset === 'table') return at(Math.min(MAX_ZOOM, overview * 1.6), mid.x, mid.y);
    if (!focus.length) return at(Math.min(MAX_ZOOM, overview * 2.4), mid.x, mid.y);
    const xs = focus.map((p) => p.x);
    const ys = focus.map((p) => p.z);
    const [x0, x1] = [Math.min(...xs) - 110, Math.max(...xs) + 110];
    const [y0, y1] = [Math.min(...ys) - 130, Math.max(...ys) + 130];
    const zoom = Math.min(2.4, Math.max(overview, fit(x0, y0, x1, y1)));
    return at(zoom, (x0 + x1) / 2, (y0 + y1) / 2);
  }

  /** Zooms about a point of the canvas, keeping the board point under it still. */
  private zoomBy(factor: number, clientX?: number, clientY?: number) {
    const rect = this.canvas.getBoundingClientRect();
    const ax = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
    const ay = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
    const { zoom, x, y } = this.frame;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    this.frame = {
      zoom: next,
      x: x + ax / zoom - ax / next,
      y: y + ay / zoom - ay / next,
    };
    this.rig.release();
  }

  private attachControls() {
    const c = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.setPointerCapture(e.pointerId);
      pinch = 0;
    });
    c.addEventListener('pointermove', (e) => {
      const last = pointers.get(e.pointerId);
      if (!this.enabled || !last) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const [dx, dy] = [e.clientX - last.x, e.clientY - last.y];
        if (!dx && !dy) return;
        const { zoom, x, y } = this.frame;
        this.frame = { zoom, x: x - dx / zoom, y: y - dy / zoom };
        this.rig.release();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch) this.zoomBy(d / pinch, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
        pinch = d;
      }
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.enabled) this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      },
      { passive: false },
    );
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.max(1, Math.round(w * dpr()));
    this.canvas.height = Math.max(1, Math.round(h * dpr()));
    this.rig.refit();
  }

  // --- Positions ------------------------------------------------------------------

  private node(id: string): BoardNode {
    const n = this.board.nodes.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    return n;
  }

  nodePoint(id: string): Point {
    const p = this.at.get(id);
    if (!p) throw new Error(`unknown node ${id}`);
    return p;
  }

  private has(id: string) {
    return this.at.has(id);
  }

  /** Where `player`'s stack is drawn on a node, given the knights there. */
  private standPoint(id: string, player: PlayerId, knights: Knights = this.knights): Point {
    const { x, z } = this.nodePoint(id);
    const type = this.node(id).type;
    const present = (knights[id] ?? []).flatMap((c, p) => (c > 0 || p === player ? [p] : []));
    const slot = Math.max(0, present.indexOf(player)) - (present.length - 1) / 2;
    if (type === 'path') return { x: x + slot * 17 * G, z };
    if (type === 'start') return { x: x + slot * 16 * G, z: z + 7 * G };
    return { x: x + slot * 20 * G, z: z + 33 * G };
  }

  private stackRadius(id: string, players: number) {
    const type = this.node(id).type;
    if (type === 'start') return 7 * G;
    return (players > 1 ? 8 : type === 'castle' ? 10 : 11) * G;
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
  showGhost(ghost: { id: string; player: PlayerId } | null) {
    this.ghost = ghost && this.has(ghost.id) ? ghost : null;
  }
  showMarks(marks: Marks) {
    this.marks = marks;
  }
  showTrails(trails: readonly Trail[]) {
    this.trails = trails.filter((t) => this.has(t.from) && this.has(t.to));
  }
  showPings(ids: readonly string[]) {
    this.pings = ids.filter((id) => this.has(id));
  }
  colour(player: PlayerId | null) {
    return colourOf(player);
  }

  // --- Picking ----------------------------------------------------------------------

  private toBoard(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const { zoom, x, y } = this.frame;
    return {
      x: x + (clientX - rect.left - rect.width / 2) / zoom,
      z: y + (clientY - rect.top - rect.height / 2) / zoom,
    };
  }

  pick(clientX: number, clientY: number): string | null {
    const p = this.toBoard(clientX, clientY);
    // Small targets stay catchable when zoomed far out.
    const grow = Math.max(1, 0.6 / this.frame.zoom);
    let best: { id: string; score: number } | null = null;
    for (const n of this.board.data.nodes) {
      const a = this.nodePoint(n.id);
      const [hw, up, down] =
        n.type === 'castle'
          ? [22 * G, 22 * G, 40 * G]
          : n.type === 'start'
            ? [26 * G, 20 * G, 20 * G]
            : [18 * G, 18 * G, 18 * G];
      const [dx, dy] = [p.x - a.x, p.z - a.z];
      if (Math.abs(dx) > hw * grow || dy < -up * grow || dy > down * grow) continue;
      const score = Math.hypot(dx, dy - (n.type === 'castle' ? 10 : 0));
      if (!best || score < best.score) best = { id: n.id, score };
    }
    return best?.id ?? null;
  }

  screenPoint(id: string): { x: number; y: number } {
    const a = this.nodePoint(id);
    const rect = this.canvas.getBoundingClientRect();
    const { zoom, x, y } = this.frame;
    const lift = (this.node(id).type === 'castle' ? 26 : 14) * G;
    return {
      x: rect.left + rect.width / 2 + (a.x - x) * zoom,
      y: rect.top + rect.height / 2 + (a.z - lift - y) * zoom,
    };
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

  /** Runs an effect for `duration` and removes it. */
  private async effect<K extends Effect['kind']>(
    e: Extract<Effect, { kind: K; t: number }>,
    duration: number,
  ) {
    this.effects.add(e);
    await this.tween(duration, (t) => (e.t = t));
    this.effects.delete(e);
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
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const end = back ? 0.55 : 1;
    const walker: Effect = { kind: 'walk', player, count, x: a.x, y: a.z, hop: 0 };
    this.effects.add(walker);
    // `duration` is the time for a walk of WALK_REFERENCE, so the pace is the same on any distance.
    await this.tween(duration * Math.max(0.4, len / WALK_REFERENCE), (t) => {
      const s = back ? Math.sin(t * Math.PI) * end : t * t * (3 - 2 * t);
      walker.x = a.x + (b.x - a.x) * s;
      walker.y = a.z + (b.z - a.z) * s;
      walker.hop = Math.abs(Math.sin(s * len * 0.15)) * 4;
    });
    this.effects.delete(walker);
  }

  async burst(id: string, colour: string, duration: number) {
    await this.effect<'ring'>({ kind: 'ring', id, colour, t: 0 }, duration);
  }

  async popup(id: string, text: string, colour: string, duration: number) {
    await this.effect<'text'>({ kind: 'text', id, text, colour, t: 0 }, duration);
  }

  async drop(id: string, player: PlayerId, duration: number) {
    const key = `${id}:${player}`;
    await this.tween(duration, (t) => this.lifts.set(key, (1 - t * t) * 40));
    this.lifts.delete(key);
  }

  async pulse(id: string, colour: string, duration: number) {
    await this.effect<'pulse'>({ kind: 'pulse', id, colour, t: 0 }, duration);
  }

  async reject(id: string, player: PlayerId, duration: number) {
    await this.effect<'reject'>({ kind: 'reject', id, player, t: 0 }, duration);
  }

  async dust(id: string, colour: string, duration: number, big = false) {
    await this.effect<'dust'>({ kind: 'dust', id, colour, t: 0, big }, duration);
  }

  async clash(id: string, duration: number) {
    await Promise.all([
      this.effect<'sparks'>({ kind: 'sparks', id, t: 0 }, duration * 0.6),
      this.shake(2, duration * 0.5),
    ]);
  }

  async fall(id: string, player: PlayerId, count: number, duration: number, shift = 0) {
    if (count <= 0) return;
    const at = this.standPoint(id, player);
    await this.effect<'fall'>(
      { kind: 'fall', player, count, x: at.x + shift * 22, y: at.z, t: 0 },
      duration,
    );
  }

  async shake(amount: number, duration: number) {
    await this.tween(duration, (t) => {
      const k = (1 - t) * amount * 2;
      this.shakeX = t < 1 ? Math.sin(t * 70) * k : 0;
      this.shakeY = t < 1 ? Math.cos(t * 53) * k : 0;
    });
  }

  async revealShield(
    castle: string,
    owner: PlayerId,
    value: number,
    label: string,
    won: boolean,
    duration: number,
  ) {
    const e: Effect = {
      kind: 'reveal',
      id: castle,
      colour: colourOf(owner),
      value,
      label,
      labelColour: won ? '#9ee59e' : '#ffb4a8',
      mode: 'flip',
      t: 0,
    };
    this.effects.add(e);
    await this.tween(duration, (t) => (e.t = t));
  }

  async settleShield(castle: string, duration: number) {
    await this.endReveal(castle, 'settle', duration);
  }

  async shatterShield(castle: string, duration: number) {
    await this.endReveal(castle, 'shatter', duration);
  }

  private async endReveal(castle: string, mode: 'settle' | 'shatter', duration: number) {
    const e = [...this.effects].find((f) => f.kind === 'reveal' && f.id === castle);
    if (!e || e.kind !== 'reveal') return;
    e.mode = mode;
    e.t = 0;
    await this.tween(duration, (t) => (e.t = t));
    this.effects.delete(e);
  }

  async dropShield(castleId: string, player: PlayerId, duration: number) {
    await this.effect<'shield'>(
      { kind: 'shield', id: castleId, colour: colourOf(player), t: 0 },
      duration,
    );
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
    if (!draw || !this.enabled || this.canvas.hidden) return;
    this.paint();
  }

  /** Runs `draw` with everything scaled by `G` about a point: how nodes and what sits on them grow. */
  private grown(ctx: CanvasRenderingContext2D, at: Point, draw: () => void) {
    ctx.save();
    ctx.translate(at.x, at.z);
    ctx.scale(G, G);
    ctx.translate(-at.x, -at.z);
    draw();
    ctx.restore();
  }

  /**
   * Edges, nodes and castle names never change between two game moves, so they
   * are drawn once into a bitmap that panning only moves. It is drawn again when
   * a castle changes hands, the names are toggled or the zoom has left the
   * resolution it was drawn at.
   */
  private layer: { canvas: HTMLCanvasElement; scale: number; key: string } | null = null;

  private boardLayer() {
    const b = this.bounds;
    const [w, h] = [b.x1 - b.x0, b.y1 - b.y0];
    const limit = MAX_LAYER / Math.max(w, h);
    const want = Math.min(limit, this.frame.zoom * dpr());
    const key = `${this.labels}|${Object.entries(this.castles)
      .map(([id, c]) => `${id}${c.owner}`)
      .join()}`;
    const l = this.layer;
    if (l && l.key === key && want >= l.scale * 0.7 && (want <= l.scale * 1.5 || l.scale >= limit))
      return l;
    const canvas = l?.canvas ?? document.createElement('canvas');
    canvas.width = Math.ceil(w * want);
    canvas.height = Math.ceil(h * want);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(want, 0, 0, want, -b.x0 * want, -b.y0 * want);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this.paintEdges(ctx);
    for (const n of this.board.data.nodes)
      this.grown(ctx, this.nodePoint(n.id), () => this.paintNode(ctx, n));
    if (this.labels) this.paintLabels(ctx);
    return (this.layer = { canvas, scale: want, key });
  }

  private paint() {
    const ctx = this.ctx;
    const k = dpr();
    const { zoom, x, y } = this.frame;
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(
      k * zoom,
      0,
      0,
      k * zoom,
      k * (this.canvas.clientWidth / 2 - x * zoom + this.shakeX),
      k * (this.canvas.clientHeight / 2 - y * zoom + this.shakeY),
    );
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const b = this.bounds;
    ctx.drawImage(this.boardLayer().canvas, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    this.paintMarks(ctx);
    for (const n of this.board.data.nodes) this.paintStacks(ctx, n.id);
    if (this.trailsVisible) for (const t of this.trails) this.paintTrail(ctx, t);
    this.paintShields(ctx);
    this.paintCosts(ctx);
    if (this.ghost) this.paintGhost(ctx, this.ghost.id, this.ghost.player);
    for (const e of this.effects) this.paintEffect(ctx, e);
  }

  private paintEdges(ctx: CanvasRenderingContext2D) {
    for (const [a, b] of this.board.data.edges) {
      const [p, q] = [this.nodePoint(a), this.nodePoint(b)];
      const access = this.node(a).type === 'castle' || this.node(b).type === 'castle';
      ctx.beginPath();
      ctx.moveTo(p.x, p.z);
      ctx.lineTo(q.x, q.z);
      ctx.strokeStyle = access ? '#3d2b16' : '#ffffff';
      ctx.lineWidth = access ? 1.5 : 2;
      ctx.setLineDash(access ? [] : [2, 5]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** The outline round a node, for highlights. */
  private ringPath(ctx: CanvasRenderingContext2D, id: string, grow = 0) {
    const { x, z } = this.nodePoint(id);
    const type = this.node(id).type;
    ctx.beginPath();
    if (type === 'path') ctx.arc(x, z, 17 + grow, 0, Math.PI * 2);
    else if (type === 'start')
      ctx.roundRect(x - 26 - grow, z - 20 - grow, 52 + grow * 2, 40 + grow * 2, 9 + grow);
    else ctx.roundRect(x - 25 - grow, z - 28 - grow, 50 + grow * 2, 74 + grow * 2, 10 + grow);
  }

  private paintMarks(ctx: CanvasRenderingContext2D) {
    const blink = Math.floor(this.now / 330) % 2;
    const m = this.marks;
    const mark = (id: string, colour: string, width = 3, pulse = false, grow = 0) => {
      if (!this.has(id)) return;
      this.grown(ctx, this.nodePoint(id), () => {
        this.ringPath(ctx, id, grow + (pulse ? blink * 1.5 : 0));
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.stroke();
      });
    };
    for (const id of m.selectable) if (id !== m.selected) mark(id, HIGHLIGHT.selectable, 2, true);
    if (m.selected) mark(m.selected, HIGHLIGHT.selected, 4, false, 2);
    for (const id of m.moves) mark(id, HIGHLIGHT.move, 4, true);
    for (const id of m.castles) mark(id, HIGHLIGHT.castle, 4, true);
    for (const id of m.fields) mark(id, HIGHLIGHT.field, 4, true);
    if (m.target) mark(m.target, HIGHLIGHT.field, 5, true, 3);
    for (const [id, count] of m.sources) mark(id, HIGHLIGHT.source, count ? 4 : 2, !count);
    if (m.shield) mark(m.shield, HIGHLIGHT.shield, 5, true, 3);
    for (const id of this.pings) mark(id, '#ffffff', 4, true, 3);
  }

  private paintNode(ctx: CanvasRenderingContext2D, n: BoardNode) {
    const { x, z } = this.nodePoint(n.id);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#5b4a2a';
    if (n.type === 'path') {
      ctx.beginPath();
      ctx.arc(x, z, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#e9d9a6';
      ctx.fill();
      ctx.stroke();
    } else if (n.type === 'start') {
      ctx.beginPath();
      ctx.roundRect(x - 22, z - 16, 44, 32, 5);
      ctx.fillStyle = '#f4ecd8';
      ctx.fill();
      ctx.stroke();
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#5b4a2a';
      ctx.fillText(String(n.number), x, z - 8);
    } else {
      const owner = this.castles[n.id]?.owner ?? null;
      ctx.beginPath();
      ctx.moveTo(x - 17, z + 14);
      ctx.lineTo(x - 17, z - 8);
      ctx.lineTo(x - 10, z - 8);
      ctx.lineTo(x - 10, z - 14);
      ctx.lineTo(x - 4, z - 14);
      ctx.lineTo(x - 4, z - 8);
      ctx.lineTo(x + 4, z - 8);
      ctx.lineTo(x + 4, z - 14);
      ctx.lineTo(x + 10, z - 14);
      ctx.lineTo(x + 10, z - 8);
      ctx.lineTo(x + 17, z - 8);
      ctx.lineTo(x + 17, z + 14);
      ctx.closePath();
      ctx.fillStyle = colourOf(owner);
      ctx.strokeStyle = INK;
      ctx.fill();
      ctx.stroke();
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = INK;
      ctx.fillText('⚔'.repeat(n.value), x, z + 25);
    }
  }

  /** A disc in a player's colour with the count. */
  private disc(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    p: PlayerId,
    count: number,
  ) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = colourOf(p);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000a';
    ctx.stroke();
    this.text(ctx, String(count), x, y + 0.5, r * 1.2);
  }

  /** White bold text with a dark halo. */
  private text(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    size: number,
    colour = '#ffffff',
  ) {
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0009';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }

  private paintStacks(ctx: CanvasRenderingContext2D, id: string) {
    const counts = this.knights[id];
    if (!counts) return;
    const present = counts.filter((c) => c > 0).length;
    const r = this.stackRadius(id, present);
    counts.forEach((c, p) => {
      if (!c) return;
      const at = this.standPoint(id, p);
      this.disc(ctx, at.x, at.z - (this.lifts.get(`${id}:${p}`) ?? 0), r, p, c);
    });
  }

  private shieldText(view: CastleView) {
    const s = view.shield!;
    return s.revealed ? String(s.value ?? '?') : s.value === null ? '?' : `(${s.value})`;
  }

  private shieldBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    colour: string,
    text: string,
    revealed: boolean,
    width = 1,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(width, 1);
    ctx.fillStyle = revealed ? '#f2f2f2' : colour;
    ctx.strokeStyle = revealed ? colour : '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.fill(SHIELD_PATH);
    ctx.stroke(SHIELD_PATH);
    ctx.restore();
    if (width > 0.3) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(width, 1);
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = revealed ? colour : '#ffffff';
      ctx.fillText(text, 0, 1);
      ctx.restore();
    }
  }

  private paintShields(ctx: CanvasRenderingContext2D) {
    // A shield being turned over is drawn by its effect instead.
    const revealing = new Set(
      [...this.effects].flatMap((e) => (e.kind === 'reveal' ? [e.id] : [])),
    );
    for (const [id, view] of Object.entries(this.castles)) {
      if (!view.shield || view.owner === null || !this.has(id) || revealing.has(id)) continue;
      const { x, z } = this.nodePoint(id);
      const shield = view.shield;
      this.grown(ctx, { x, z }, () =>
        this.shieldBadge(
          ctx,
          x + 19,
          z - 12,
          colourOf(view.owner),
          this.shieldText(view),
          shield.revealed,
        ),
      );
    }
  }

  private paintLabels(ctx: CanvasRenderingContext2D) {
    for (const n of this.board.data.nodes) {
      if (n.type !== 'castle') continue;
      this.text(ctx, n.name, n.x * this.size.width, n.y * this.size.height - 24 * G, 11 * G);
    }
  }

  /** The cost of targets more than one step away. */
  private paintCosts(ctx: CanvasRenderingContext2D) {
    for (const [id, cost] of this.marks.costs) {
      if (cost < 2 || !this.has(id)) continue;
      const colour = this.marks.castles.has(id) ? HIGHLIGHT.castle : HIGHLIGHT.move;
      const { x, z } = this.nodePoint(id);
      const [bx, by] = this.node(id).type === 'castle' ? [x + 22, z + 8] : [x + 15, z + 10];
      this.grown(ctx, { x, z }, () => {
        ctx.beginPath();
        ctx.arc(bx, by, 8, 0, Math.PI * 2);
        ctx.fillStyle = INK;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = colour;
        ctx.stroke();
        this.text(ctx, String(cost), bx, by + 0.5, 10);
      });
    }
  }

  private paintGhost(
    ctx: CanvasRenderingContext2D,
    id: string,
    player: PlayerId,
    refused: number | null = null,
  ) {
    const a = this.standPoint(id, player);
    this.grown(ctx, a, () => this.ghostAt(ctx, a, player, refused));
  }

  private ghostAt(
    ctx: CanvasRenderingContext2D,
    a: Point,
    player: PlayerId,
    refused: number | null,
  ) {
    const waiting = refused === null;
    const bob = waiting ? Math.sin(this.now / 260) * 2 : 0;
    ctx.save();
    ctx.globalAlpha = waiting ? 0.75 : 0.8 * (1 - refused);
    ctx.beginPath();
    ctx.arc(a.x, a.z - 22 - bob + (waiting ? 0 : refused * 22), 8, 0, Math.PI * 2);
    ctx.fillStyle = waiting ? colourOf(player) : '#ff5a4d';
    ctx.fill();
    ctx.restore();
    if (waiting) {
      ctx.beginPath();
      ctx.arc(a.x, a.z, 9, 0, Math.PI * 2);
      ctx.strokeStyle = colourOf(player);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private paintTrail(ctx: CanvasRenderingContext2D, t: Trail) {
    const a = this.standPoint(t.from, t.player);
    const b = this.standPoint(t.to, t.player);
    const f = t.kind === 'lost' ? 0.6 : 0.82;
    const end = { x: a.x + (b.x - a.x) * f, y: a.z + (b.z - a.z) * f };
    const lift = 10 + Math.hypot(end.x - a.x, end.y - a.z) * 0.12;
    const mid = { x: (a.x + end.x) / 2, y: (a.z + end.y) / 2 - lift };
    const colour = colourOf(t.player);
    const stroke = (width: number, style: string, dash: number[]) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.z);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.setLineDash(dash);
      ctx.lineWidth = width;
      ctx.strokeStyle = style;
      ctx.stroke();
    };
    // Moves are dashed, battles solid.
    const dash = t.kind === 'move' ? [6, 5] : [];
    stroke(5, '#000a', dash);
    stroke(3, colour, dash);
    ctx.setLineDash([]);
    const angle = Math.atan2(end.y - mid.y, end.x - mid.x);
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - Math.cos(angle - 0.5) * 11, end.y - Math.sin(angle - 0.5) * 11);
    ctx.lineTo(end.x - Math.cos(angle + 0.5) * 11, end.y - Math.sin(angle + 0.5) * 11);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.strokeStyle = '#000a';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    if (t.kind === 'lost') this.text(ctx, '✖', end.x, end.y - 12, 14, '#ff6b5e');
  }

  private paintEffect(ctx: CanvasRenderingContext2D, e: Effect) {
    if (e.kind === 'walk') {
      this.disc(ctx, e.x, e.y - e.hop, 11 * G, e.player, e.count);
      return;
    }
    if (e.kind === 'fall') return this.paintFall(ctx, e);
    const a = this.nodePoint(e.id);
    if (e.kind === 'reject') return this.paintGhost(ctx, e.id, e.player, e.t);
    this.grown(ctx, a, () => this.paintNodeEffect(ctx, e, a));
  }

  /** An effect drawn in the node's own proportions, scaled up with it. */
  private paintNodeEffect(ctx: CanvasRenderingContext2D, e: Effect, a: Point) {
    if (e.kind === 'walk' || e.kind === 'fall' || e.kind === 'reject') return;
    const big = this.node(e.id).type === 'castle';
    if (e.kind === 'ring') {
      const r = (big ? 30 : 16) + e.t * 30;
      if (e.t < 0.85) this.circle(ctx, a.x, a.z, r, e.colour, 3);
      if (e.t < 0.5) this.circle(ctx, a.x, a.z, r * 0.7, '#ffffff', 1.5);
    } else if (e.kind === 'text') {
      if (e.t < 0.9) this.text(ctx, e.text, a.x, a.z - (big ? 40 : 28) - e.t * 24, 15, e.colour);
    } else if (e.kind === 'shield') {
      this.shieldBadge(ctx, a.x + 19, a.z - 12 - (1 - e.t * e.t) * 90, e.colour, '', false);
    } else if (e.kind === 'pulse') {
      const beat = (e.t * 2) % 1;
      if (e.t < 1) this.circle(ctx, a.x, a.z, 24 + beat * 14, beat < 0.7 ? e.colour : '#ffffff', 3);
    } else if (e.kind === 'dust') {
      this.paintBurst(ctx, a, e.t, e.big ? 28 : 18, e.big ? 12 : 8, [e.colour, '#d8cfb8']);
    } else if (e.kind === 'sparks') {
      if (e.t < 0.3) this.circle(ctx, a.x, a.z - 4, 6 + e.t * 40, '#fff6c0', 3);
      this.paintBurst(ctx, a, e.t, 28, 10, ['#fff6c0', '#ffd34a']);
    } else if (e.kind === 'reveal') {
      this.paintReveal(ctx, e, a);
    }
  }

  private circle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    colour: string,
    width: number,
  ) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  /** Specks flying outwards from a point and fading. */
  private paintBurst(
    ctx: CanvasRenderingContext2D,
    at: Point,
    t: number,
    reach: number,
    n: number,
    colours: string[],
  ) {
    if (t >= 0.95) return;
    ctx.save();
    ctx.globalAlpha = 1 - t * t;
    for (let k = 0; k < n; k++) {
      const angle = (k / n) * Math.PI * 2 + (k % 2) * 0.3;
      const r = reach * (0.35 + 0.65 * Math.sqrt(t)) * (0.7 + (0.3 * ((k * 7) % 3)) / 2);
      ctx.fillStyle = colours[k % colours.length]!;
      ctx.beginPath();
      ctx.arc(
        at.x + Math.cos(angle) * r,
        at.z + Math.sin(angle) * r - 4,
        t < 0.45 ? 2.5 : 1.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  /** Defeated knights one by one: the stack flickers and sinks. */
  private paintFall(ctx: CanvasRenderingContext2D, e: Extract<Effect, { kind: 'fall' }>) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - e.t) * (Math.floor(this.now / 70) % 2 ? 0.6 : 1);
    this.disc(ctx, e.x, e.y + e.t * 8 * G, 11 * G, e.player, e.count);
    ctx.restore();
  }

  private paintReveal(
    ctx: CanvasRenderingContext2D,
    e: Extract<Effect, { kind: 'reveal' }>,
    a: Point,
  ) {
    const text = String(e.value);
    const [hx, hy] = [a.x + 19, a.z - 12];
    const lift = 30;
    if (e.mode === 'flip') {
      const rise = Math.min(1, e.t / 0.25);
      const y = hy - (1 - (1 - rise) ** 2) * lift;
      const turn = Math.max(0, Math.min(1, (e.t - 0.25) / 0.35));
      const width = Math.abs(Math.cos(turn * Math.PI));
      this.shieldBadge(ctx, hx, y, e.colour, turn < 0.5 ? '?' : text, turn >= 0.5, width);
      if (e.t >= 0.6) this.text(ctx, e.label, hx, y - 18, 12, e.labelColour);
    } else if (e.mode === 'settle') {
      this.shieldBadge(ctx, hx, hy - (1 - e.t * e.t) * lift, e.colour, text, true);
    } else {
      this.paintBurst(ctx, { x: hx, z: hy - lift + 6 }, e.t, 36, 14, [
        e.colour,
        '#efe2c0',
        INK,
        '#ffffff',
      ]);
    }
  }
}
