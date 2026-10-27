import type { DieView } from './dieView';
import type { BoardView } from './boardView';
import {
  countsAfter,
  departed,
  siegeNeed,
  siegeTiming,
  stepDuration,
  type Knights,
  type Step,
} from './steps';

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
    private readonly scene: BoardView,
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
    // Steps with several parts ask again for each, so a hurry also shortens the rest of them.
    const part = (base: number) => (this.hurrying ? 0 : base * this.speed);
    const s = this.scene;
    switch (step.kind) {
      case 'roll':
        await this.die.throw(step.value, ms);
        return;
      case 'place':
        // The ghost that waited for the start area turns solid as it lands.
        s.showGhost(null);
        s.showKnights(countsAfter(knights, step));
        await s.drop(step.start, step.player, ms * 0.7);
        await s.dust(step.start, s.colour(step.player), part(stepDuration(step) * 0.3));
        return;
      case 'spawnPending':
        s.showGhost({ id: step.start, player: step.player });
        await s.pulse(step.start, s.colour(step.player), ms);
        return;
      case 'blocked':
        await s.reject(step.start, step.player, ms);
        return;
      case 'travel': {
        s.showKnights(departed(knights, step));
        if (!step.battle) {
          await Promise.all(
            step.sources.map((c) => s.travel(step.player, c.from, step.to, c.count, ms)),
          );
          return;
        }
        // The attackers arrive, clash with the defenders, who fall as the victors settle in.
        const { defender, defeated } = step.battle;
        const total = stepDuration(step);
        await Promise.all(
          step.sources.map((c) => s.travel(step.player, c.from, step.to, c.count, ms * 0.4)),
        );
        const fight = part(total * 0.6);
        const falling = s.fall(step.to, defender, defeated, fight * 0.8, -0.5);
        s.showKnights(countsAfter(knights, step));
        await Promise.all([
          falling,
          s.clash(step.to, fight),
          s.burst(step.to, s.colour(step.player), fight),
        ]);
        return;
      }
      case 'siege': {
        const time = siegeTiming(step);
        // The attackers leave their marker for the lunge and come back if they lose.
        s.showKnights(countsAfter(knights, { ...step, won: false }));
        await s.travel(
          step.player,
          step.from,
          step.castle,
          step.attackers,
          ms * (time.lunge / time.total),
          true,
        );
        const shielded = step.shield !== null && step.defender !== null;
        if (shielded)
          await s.revealShield(
            step.castle,
            step.defender!,
            step.shield!,
            `${step.attackers} VS ${siegeNeed(step)}`,
            step.won,
            part(time.reveal),
          );
        const outcome = part(time.outcome);
        const after = countsAfter(knights, step);
        if (step.won) {
          // The defenders of the castle fall; its shield breaks.
          const falling =
            step.defender === null
              ? Promise.resolve()
              : s.fall(step.castle, step.defender, step.garrison, outcome * 0.8);
          s.showKnights(after);
          await Promise.all([
            falling,
            shielded ? s.shatterShield(step.castle, outcome) : Promise.resolve(),
            s.dust(step.castle, s.colour(step.player), outcome, true),
            s.burst(step.castle, s.colour(step.player), outcome),
          ]);
        } else {
          // Every attacker on the marker falls; the shield stays, face-up.
          const falling = s.fall(step.from, step.player, step.attackers, outcome * 0.8);
          s.showKnights(after);
          await Promise.all([
            falling,
            shielded ? s.settleShield(step.castle, outcome * 0.5) : Promise.resolve(),
            s.shake(1, outcome * 0.4),
            s.burst(step.from, '#ff3b2f', outcome),
          ]);
        }
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
