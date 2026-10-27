import { apply } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { demoStages } from '../src/dev/demo';
import { planSteps } from '../src/game/steps';

describe('demo stages', () => {
  it('play with legal actions and show the animations they are made for', () => {
    const kinds = demoStages().map((stage) => {
      let state = stage.state;
      const steps: string[] = [];
      for (const { action } of stage.steps) {
        const next = apply(state, typeof action === 'function' ? action(state) : action);
        steps.push(...planSteps(next.events).map((s) => s.kind));
        state = next.state;
      }
      return [stage.title, steps] as const;
    });
    const by = Object.fromEntries(kinds);
    expect(by['Spawn']).toEqual(['roll', 'place']);
    expect(by['Spawn onto your own knight']).toEqual(['roll', 'spawnPending', 'travel', 'place']);
    expect(by['Spawn with nowhere to step']).toEqual(['roll', 'blocked']);
    expect(by['Field battle']).toEqual(['travel']);
    expect(by['Castle attack, shield 3: lost']).toEqual(['siege']);
    expect(by['Castle attack, shield 2: taken']).toEqual(['siege', 'enter']);
    expect(by['Neutral castle taken']).toEqual(['siege', 'enter']);
  });
});
