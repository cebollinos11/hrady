import { apply, initialState, legalActions, type GameState } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { lcg, progressBot } from '../../../packages/engine/test/bot';
import { rigRoll, scenario } from '../../../packages/engine/test/fixtures';
import {
  countsAfter,
  departed,
  planSteps,
  siegeNeed,
  siegeTiming,
  stepDuration,
  type Knights,
} from '../src/game/steps';

/** Knights as `node:player` → count, without empty entries, for comparing. */
function flat(knights: Knights): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [node, counts] of Object.entries(knights))
    counts.forEach((c, p) => {
      if (c) out[`${node}:${p}`] = c;
    });
  return out;
}

describe('planSteps', () => {
  it('turns a move into a single-source trip', () => {
    const state = scenario({ knights: { a: { 0: 3 } } });
    const { events } = apply(state, { type: 'move', player: 0, from: 'a', to: 'b', count: 2 });
    expect(planSteps(events)).toEqual([
      { kind: 'travel', player: 0, sources: [{ from: 'a', count: 2 }], to: 'b', battle: null },
    ]);
  });

  it('turns a field battle into a trip that beats the defenders', () => {
    const state = scenario({ knights: { a: { 0: 2 }, f: { 0: 1 }, b: { 1: 2 } } });
    const { events } = apply(state, {
      type: 'attackField',
      player: 0,
      target: 'b',
      contributions: [
        { from: 'a', count: 2 },
        { from: 'f', count: 1 },
      ],
    });
    const [step] = planSteps(events);
    expect(step).toMatchObject({ kind: 'travel', to: 'b', battle: { defender: 1, defeated: 2 } });
    expect(flat(countsAfter(state.knights, step!))).toEqual({ 'b:0': 3 });
  });

  it('lets conquering knights enter from the attacking marker', () => {
    const state = scenario({ knights: { d: { 0: 6 } } });
    const { events } = apply(state, {
      type: 'attackCastle',
      player: 0,
      castle: 'tower',
      from: 'd',
      count: 2,
    });
    const steps = planSteps(events);
    expect(steps.map((s) => s.kind)).toEqual(['siege', 'enter']);
    expect(steps[1]).toMatchObject({ from: 'd', castle: 'tower', count: 2 });
    const after = steps.reduce(countsAfter, state.knights);
    expect(flat(after)).toEqual({ 'd:0': 4, 'tower:0': 2 });
    expect(stepDuration(steps[0]!)).toBeGreaterThan(0);
  });

  it('sends every attacker home after a lost siege', () => {
    const state = scenario({
      knights: { d: { 0: 4, 1: 0 }, tower: { 1: 1 } },
      castles: { tower: { owner: 1, shield: { value: 3, revealed: false } } },
    });
    const { events } = apply(state, {
      type: 'attackCastle',
      player: 0,
      castle: 'tower',
      from: 'd',
      count: 1,
    });
    const steps = planSteps(events);
    expect(steps).toEqual([expect.objectContaining({ kind: 'siege', won: false, shield: 3 })]);
    expect(flat(steps.reduce(countsAfter, state.knights))).toEqual({ 'tower:1': 1 });
  });

  it('waits for the knight on the start area to leave before the new one lands', () => {
    // Find the start area die 3 spawns on, and put the player's own knight there.
    const fresh = rigRoll(initialState({ players: 3 }, 1), 3);
    const start = apply(fresh, { type: 'roll', player: 0 }).events.find(
      (e) => e.type === 'knightPlaced',
    )!;
    if (start.type !== 'knightPlaced') throw new Error('no spawn');
    const occupied = { ...fresh, knights: { ...fresh.knights, [start.start]: [1, 0, 0] } };

    const rolled = apply(occupied, { type: 'roll', player: 0 });
    expect(planSteps(rolled.events).map((s) => s.kind)).toEqual(['roll', 'spawnPending']);
    // Nothing lands yet: the board still shows the one knight.
    expect(flat(planSteps(rolled.events).reduce(countsAfter, occupied.knights))).toEqual(
      flat(occupied.knights),
    );

    const stepOff = legalActions(rolled.state, 0).find((a) => a.type === 'move')!;
    const moved = apply(rolled.state, stepOff);
    const steps = planSteps(moved.events);
    expect(steps.map((s) => s.kind)).toEqual(['travel', 'place']);
    expect(flat(steps.reduce(countsAfter, occupied.knights))).toEqual(flat(moved.state.knights));
  });

  it('marks a start area that cannot be cleared as blocked', () => {
    expect(planSteps([{ type: 'placementSkipped', player: 1, start: 's2' }])).toEqual([
      { kind: 'blocked', player: 1, start: 's2' },
    ]);
  });

  it('does not modify the counts it is given', () => {
    const before = { a: [2, 0, 0] };
    countsAfter(before, {
      kind: 'travel',
      player: 0,
      sources: [{ from: 'a', count: 2 }],
      to: 'b',
      battle: null,
    });
    expect(before).toEqual({ a: [2, 0, 0] });
  });
});

describe('departed', () => {
  it('takes the travellers off their nodes until they arrive', () => {
    const before = { a: [3, 0, 0], f: [1, 0, 0], b: [0, 2, 0] };
    const step = {
      kind: 'travel' as const,
      player: 0,
      sources: [
        { from: 'a', count: 2 },
        { from: 'f', count: 1 },
      ],
      to: 'b',
      battle: { defender: 1, defeated: 2 },
    };
    expect(flat(departed(before, step))).toEqual({ 'a:0': 1, 'b:1': 2 });
  });

  it('takes the knights entering a castle off the marker', () => {
    const before = { d: [6, 0, 0] };
    const step = { kind: 'enter' as const, player: 0, castle: 'tower', from: 'd', count: 2 };
    expect(flat(departed(before, step))).toEqual({ 'd:0': 4 });
    expect(departed(before, { kind: 'roll', player: 0, value: 3 })).toEqual(before);
  });
});

describe('countsAfter over whole games', () => {
  it('always ends on the knights of the next state', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const bot = progressBot(lcg(seed));
      let state: GameState = initialState({ players: 3 + (seed % 3) }, seed);
      for (let i = 0; i < 1500 && state.phase !== 'over'; i++) {
        const { state: next, events } = apply(state, bot(state));
        const shown = planSteps(events).reduce(countsAfter, state.knights);
        expect(flat(shown)).toEqual(flat(next.knights));
        state = next;
      }
    }
  });
});

describe('siege timing', () => {
  it('only spends time on the shield flip when the castle has a shield', () => {
    expect(siegeTiming({ shield: null }).reveal).toBe(0);
    expect(siegeTiming({ shield: 0 }).reveal).toBeGreaterThan(0);
    const t = siegeTiming({ shield: 2 });
    expect(t.total).toBe(t.lunge + t.reveal + t.outcome);
  });

  it('needs twice the garrison and the shield', () => {
    expect(siegeNeed({ garrison: 2, shield: 3 })).toBe(10);
    expect(siegeNeed({ garrison: 3, shield: null })).toBe(6);
  });
});
