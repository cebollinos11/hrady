import { playerName } from '../shared/describe';
import type { DieView } from './dieView';
import type { BoardScene } from './scene';
import { countsAfter, departed, stepDuration, type Knights, type Step } from './steps';

/** One applied action to show: the knights shown before it, its steps and the final picture. */
export interface Job {
  before: Knights;
  steps: Step[];
  /** Shows the view after the action (castles, shields, knights). */
  done: () => void;
}

/**
 * Plays animation jobs one after the other. `speed` scales every duration
 * (0 = no animations); `hurry()` finishes everything queued at once, e.g.
 * when the player clicks during an animation.
 */
export class Animator {
  speed = 1;
  /** Called whenever the last queued job has finished. */
  onIdle: () => void = () => {};
  private queue: Job[] = [];
  private running = false;
  private hurrying = false;
  private idle: (() => void)[] = [];

  constructor(
    private readonly scene: BoardScene,
    private readonly die: DieView,
  ) {}

  get busy() {
    return this.running || this.queue.length > 0;
  }

  enqueue(job: Job) {
    this.queue.push(job);
    if (!this.running) void this.run();
  }

  /** Finishes the running and queued jobs without waiting. */
  hurry() {
    if (!this.busy) return;
    this.hurrying = true;
    this.scene.finishTweens();
  }

  /** Drops every queued job (the caller then shows the current view itself). */
  clear() {
    this.queue = [];
    this.hurry();
  }

  /** Resolves once nothing is queued or running. */
  whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.idle.push(resolve));
  }

  private async run() {
    this.running = true;
    while (this.queue.length) {
      const job = this.queue.shift()!;
      let knights = job.before;
      for (const step of job.steps) {
        await this.play(step, knights);
        knights = countsAfter(knights, step);
        this.scene.showKnights(knights);
      }
      job.done();
    }
    this.running = false;
    this.hurrying = false;
    const idle = this.idle;
    this.idle = [];
    for (const resolve of idle) resolve();
    this.onIdle();
  }

  private ms(step: Step) {
    return this.hurrying ? 0 : stepDuration(step) * this.speed;
  }

  private async play(step: Step, knights: Knights) {
    const ms = this.ms(step);
    const s = this.scene;
    switch (step.kind) {
      case 'roll':
        await this.die.throw(step.value, ms);
        return;
      case 'place':
        s.showKnights(countsAfter(knights, step));
        await s.drop(step.start, step.player, ms);
        return;
      case 'skip':
        await s.popup(step.start, `${playerName(step.player)} already here`, '#dddddd', ms);
        return;
      case 'travel': {
        s.showKnights(departed(knights, step));
        const walk = step.battle ? ms * 0.55 : ms;
        await Promise.all(
          step.sources.map((c) => s.travel(step.player, c.from, step.to, c.count, walk)),
        );
        if (step.battle) {
          s.showKnights(countsAfter(knights, step));
          await s.burst(step.to, s.colour(step.player), ms - walk);
        }
        return;
      }
      case 'siege': {
        const defence =
          step.shield === null
            ? step.defender === null
              ? `${step.garrison} ⚔`
              : 'No shield'
            : `Shield ${step.shield}`;
        // The attackers leave their marker for the lunge and come back if they win.
        const away = countsAfter(knights, { ...step, won: false });
        s.showKnights(away);
        await Promise.all([
          s.travel(step.player, step.from, step.castle, step.attackers, ms * 0.5, true),
          s.popup(
            step.castle,
            `${defence} · ${step.won ? 'taken' : 'held'}`,
            step.won ? '#ffffff' : '#ffb4a8',
            ms * 0.8,
          ),
        ]);
        s.showKnights(countsAfter(knights, step));
        await s.burst(
          step.won ? step.castle : step.from,
          step.won ? s.colour(step.player) : '#ff3b2f',
          ms * 0.4,
        );
        return;
      }
      case 'enter':
        s.showKnights(departed(knights, step));
        await s.travel(step.player, step.from, step.castle, step.count, ms);
        return;
      case 'shield':
        await s.dropShield(step.castle, step.player, ms);
        return;
      case 'turn':
      case 'over':
        return;
    }
  }
}
