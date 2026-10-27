import { describe, expect, it } from 'vitest';
import { Animator } from '../src/game/animator';
import type { BoardView } from '../src/game/boardView';
import type { DieView } from '../src/game/dieView';
import { planSteps, siegeTiming, type Step } from '../src/game/steps';

/** Where each timed effect of the scene takes its duration. */
const DURATION_ARG: Record<string, number> = {
  travel: 4,
  drop: 2,
  dust: 2,
  pulse: 2,
  reject: 2,
  burst: 2,
  fall: 3,
  clash: 1,
  shake: 1,
  revealShield: 5,
  settleShield: 1,
  shatterShield: 1,
};

/** A board that only records what it is asked to show; effects last until `finishTweens`. */
function fakeScene() {
  const calls: string[] = [];
  let pending: (() => void)[] = [];
  let ghost: unknown = null;
  const scene = new Proxy({} as Record<string, unknown>, {
    get(_, name: string) {
      if (name === 'finishTweens')
        return () => {
          const all = pending;
          pending = [];
          for (const resolve of all) resolve();
        };
      if (name === 'colour') return () => '#ffffff';
      if (name === 'showGhost')
        return (g: unknown) => {
          ghost = g;
          calls.push(`showGhost:${g ? 'on' : 'off'}`);
        };
      return (...args: unknown[]) => {
        calls.push(name);
        // Like the real scene, an effect with no time finishes at once; the others wait.
        const at = DURATION_ARG[name];
        if (at === undefined || (args[at] as number) <= 0) return undefined;
        return new Promise<void>((resolve) => pending.push(resolve));
      };
    },
  }) as unknown as BoardView;
  return { scene, calls, ghost: () => ghost, waiting: () => pending.length };
}

const die = { throw: async () => {}, show: () => {} } as unknown as DieView;

const siege = (over: Partial<Extract<Step, { kind: 'siege' }>> = {}): Step => ({
  kind: 'siege',
  player: 0,
  castle: 'tower',
  from: 'd',
  attackers: 6,
  defender: 1,
  garrison: 2,
  shield: 2,
  won: false,
  ...over,
});

describe('Animator', () => {
  it('plays a lost siege with a shield: lunge, flip, fall, settle', async () => {
    const { scene, calls } = fakeScene();
    const animator = new Animator(scene, die);
    animator.speed = 0;
    // With speed 0 nothing waits, so all durations are 0 and the awaits chain through at once.
    const steps = [siege()];
    animator.enqueue({
      before: { d: [6, 0, 0], tower: [0, 2, 0] },
      steps,
      done: () => void calls.push('done'),
    });
    // The fake keeps timed effects pending, so release them as they come.
    for (let i = 0; i < 20 && animator.busy; i++) {
      scene.finishTweens();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(animator.busy).toBe(false);
    const order = calls.filter((c) =>
      ['travel', 'revealShield', 'fall', 'settleShield', 'shatterShield', 'done'].includes(c),
    );
    expect(order).toEqual(['travel', 'revealShield', 'fall', 'settleShield', 'done']);
  });

  it('shatters the shield of a castle it takes, and skips the flip without a shield', async () => {
    for (const [step, expected] of [
      [siege({ won: true }), ['travel', 'revealShield', 'fall', 'shatterShield']],
      [siege({ won: true, shield: null, defender: null }), ['travel']],
    ] as const) {
      const { scene, calls } = fakeScene();
      const animator = new Animator(scene, die);
      animator.enqueue({ before: { d: [6, 0, 0] }, steps: [step], done: () => {} });
      for (let i = 0; i < 40 && animator.busy; i++) {
        scene.finishTweens();
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(animator.busy).toBe(false);
      expect(
        calls.filter((c) => ['travel', 'revealShield', 'fall', 'shatterShield'].includes(c)),
      ).toEqual(expected);
    }
  });

  it('hurry finishes a battle and leaves no ghost', async () => {
    const { scene, calls, ghost } = fakeScene();
    const animator = new Animator(scene, die);
    const steps = planSteps([{ type: 'knightPlaced', player: 0, start: 's1' }]);
    animator.enqueue({ before: {}, steps, done: () => void calls.push('done') });
    animator.hurry();
    await animator.whenIdle();
    expect(calls).toContain('done');
    expect(ghost()).toBeNull();
  });

  it('shows the ghost at the start of a blocked spawn and removes it when the knight lands', async () => {
    const { scene, calls, ghost } = fakeScene();
    const animator = new Animator(scene, die);
    animator.speed = 0;
    animator.enqueue({
      before: { s1: [1, 0, 0] },
      steps: [{ kind: 'spawnPending', player: 0, start: 's1' }],
      done: () => {},
    });
    for (let i = 0; i < 10 && animator.busy; i++) {
      scene.finishTweens();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(ghost()).toEqual({ id: 's1', player: 0 });
    animator.enqueue({
      before: {},
      steps: [{ kind: 'place', player: 0, start: 's1' }],
      done: () => {},
    });
    for (let i = 0; i < 10 && animator.busy; i++) {
      scene.finishTweens();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(ghost()).toBeNull();
    expect(calls.filter((c) => c.startsWith('showGhost'))).toEqual([
      'showGhost:on',
      'showGhost:off',
    ]);
  });

  it('plays a field battle as arrival, clash and fall', async () => {
    const { scene, calls } = fakeScene();
    const animator = new Animator(scene, die);
    animator.enqueue({
      before: { a: [3, 0, 0], b: [0, 2, 0] },
      steps: [
        {
          kind: 'travel',
          player: 0,
          sources: [{ from: 'a', count: 3 }],
          to: 'b',
          battle: { defender: 1, defeated: 2 },
        },
      ],
      done: () => {},
    });
    for (let i = 0; i < 40 && animator.busy; i++) {
      scene.finishTweens();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(animator.busy).toBe(false);
    expect(calls.filter((c) => ['travel', 'fall', 'clash'].includes(c))).toEqual([
      'travel',
      'fall',
      'clash',
    ]);
    expect(siegeTiming({ shield: null }).total).toBeGreaterThan(0);
  });
});
