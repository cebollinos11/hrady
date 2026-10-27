import type { CastleView, PlayerId } from '@hrady/engine';
import type { Marks } from '../shared/marks';
import type { Preset } from './camera';
import type { Point } from './layout';
import type { Trail } from './recent';
import type { Knights } from './steps';

/** The camera as the rest of the client drives it, whatever draws the board. */
export interface ViewRig {
  /** CSS pixels at the top of the view covered by the toolbar. */
  insetTop: number;
  /** The preset the camera is at, until the user moves it. */
  readonly current: Preset | null;
  go(preset: Preset, focus?: readonly Point[], instant?: boolean): void;
}

/**
 * What the game client needs from a board renderer: the 3D scene
 * (`scene.ts`) and the isometric pixel-art view (`iso.ts`) both provide it.
 */
export interface BoardView {
  readonly canvas: HTMLCanvasElement;
  readonly rig: ViewRig;
  setLabels(visible: boolean): void;
  setTrailsVisible(visible: boolean): void;
  showKnights(knights: Knights): void;
  showCastles(castles: Record<string, CastleView>): void;
  showMarks(marks: Marks): void;
  showTrails(trails: readonly Trail[]): void;
  showPings(ids: readonly string[]): void;
  /** The node under a point of the canvas (client coordinates), if any. */
  pick(clientX: number, clientY: number): string | null;
  /** Screen position (client coordinates) of a node, for tooltips. */
  screenPoint(id: string): { x: number; y: number };
  nodePoint(id: string): Point;
  finishTweens(): void;
  travel(
    player: PlayerId,
    from: string,
    to: string,
    count: number,
    duration: number,
    back?: boolean,
  ): Promise<void>;
  burst(id: string, colour: string, duration: number): Promise<void>;
  popup(id: string, text: string, colour: string, duration: number): Promise<void>;
  drop(id: string, player: PlayerId, duration: number): Promise<void>;
  dropShield(castleId: string, player: PlayerId, duration: number): Promise<void>;
  colour(player: PlayerId | null): string;
  resize(): void;
  /** Advances tweens and the camera; draws the frame unless `draw` is false. */
  render(now: number, draw?: boolean): void;
}

export type ViewMode = '3d' | 'iso';

/**
 * Both renderers behind one `BoardView`: calls go to the one on show, and the
 * other is brought up to date by the caller after a switch (the game client
 * redraws its state then). Tweens of the view that goes off screen are
 * finished at once, so an animation never waits for a view nobody renders.
 */
export class ViewSwitch implements BoardView {
  mode: ViewMode;

  constructor(
    private readonly views: Record<ViewMode, BoardView>,
    mode: ViewMode,
  ) {
    this.mode = mode;
    this.show();
  }

  get active(): BoardView {
    return this.views[this.mode];
  }

  /** Switches to `mode`; returns whether anything changed. */
  set(mode: ViewMode): boolean {
    if (mode === this.mode) return false;
    this.active.finishTweens();
    this.mode = mode;
    this.show();
    return true;
  }

  private show() {
    for (const [mode, view] of Object.entries(this.views)) view.canvas.hidden = mode !== this.mode;
  }

  get canvas() {
    return this.active.canvas;
  }
  get rig() {
    return this.active.rig;
  }
  setLabels(visible: boolean) {
    for (const v of Object.values(this.views)) v.setLabels(visible);
  }
  setTrailsVisible(visible: boolean) {
    for (const v of Object.values(this.views)) v.setTrailsVisible(visible);
  }
  showKnights(knights: Knights) {
    this.active.showKnights(knights);
  }
  showCastles(castles: Record<string, CastleView>) {
    this.active.showCastles(castles);
  }
  showMarks(marks: Marks) {
    this.active.showMarks(marks);
  }
  showTrails(trails: readonly Trail[]) {
    this.active.showTrails(trails);
  }
  showPings(ids: readonly string[]) {
    this.active.showPings(ids);
  }
  pick(clientX: number, clientY: number) {
    return this.active.pick(clientX, clientY);
  }
  screenPoint(id: string) {
    return this.active.screenPoint(id);
  }
  nodePoint(id: string) {
    return this.active.nodePoint(id);
  }
  finishTweens() {
    this.active.finishTweens();
  }
  travel(
    player: PlayerId,
    from: string,
    to: string,
    count: number,
    duration: number,
    back = false,
  ) {
    return this.active.travel(player, from, to, count, duration, back);
  }
  burst(id: string, colour: string, duration: number) {
    return this.active.burst(id, colour, duration);
  }
  popup(id: string, text: string, colour: string, duration: number) {
    return this.active.popup(id, text, colour, duration);
  }
  drop(id: string, player: PlayerId, duration: number) {
    return this.active.drop(id, player, duration);
  }
  dropShield(castleId: string, player: PlayerId, duration: number) {
    return this.active.dropShield(castleId, player, duration);
  }
  colour(player: PlayerId | null) {
    return this.active.colour(player);
  }
  resize() {
    for (const v of Object.values(this.views)) v.resize();
  }
  render(now: number, draw = true) {
    this.active.render(now, draw);
  }
}
