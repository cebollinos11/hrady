import type { CastleView, PlayerId } from '@hrady/engine';
import type { Marks } from '../shared/marks';
import type { Point } from './layout';
import type { Trail } from './recent';
import type { Knights } from './steps';

/** Camera presets: the whole board, the table, or the selection. */
export type Preset = 'overview' | 'table' | 'focus';

/** The camera as the rest of the client drives it, whatever draws the board. */
export interface ViewRig {
  /** CSS pixels at the top of the view covered by the toolbar. */
  insetTop: number;
  /** The preset the camera is at, until the user moves it. */
  readonly current: Preset | null;
  go(preset: Preset, focus?: readonly Point[], instant?: boolean): void;
}

/** What the game client needs from the board renderer (`PixelScene`). */
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
