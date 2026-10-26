import { apply, viewFor, type Action, type GameState } from '@hrady/engine';
import { describe, expect, it } from 'vitest';
import { scenario } from '../../engine/test/fixtures';
import {
  heuristicBot,
  perspective,
  planTurn,
  shieldOdds,
  wantsShield,
  type Observation,
} from '../src';

function plan(state: GameState, removed?: number[][]): Action[] {
  const obs: Observation = { view: viewFor(state, state.current), ...(removed && { removed }) };
  return planTurn(state, perspective(obs), shieldOdds(obs), { beam: 8 }).actions;
}

const describeAction = (a: Action) =>
  a.type === 'move'
    ? `move ${a.from}>${a.to}`
    : a.type === 'attackCastle'
      ? `attack ${a.castle}`
      : a.type === 'attackField'
        ? `field ${a.target}`
        : a.type;

describe('turn planning', () => {
  it('takes the castles it can from where it stands', () => {
    const actions = plan(scenario({ knights: { d: { 0: 6 } } })).map(describeAction);
    expect(actions).toContain('attack tower');
    expect(actions).toContain('attack hall');
  });

  it('walks to an entrance and attacks with the MP left', () => {
    const actions = plan(scenario({ knights: { c: { 0: 6 } } })).map(describeAction);
    expect(actions.slice(0, 2)).toEqual(['move c>d', 'attack tower']);
  });

  it('converges from two sides to win a field battle', () => {
    const actions = plan(scenario({ knights: { a: { 0: 2 }, c: { 0: 2 }, b: { 1: 3 } } }));
    const attack = actions.find((a) => a.type === 'attackField');
    expect(attack).toMatchObject({ target: 'b' });
    expect(attack?.type === 'attackField' && attack.contributions).toHaveLength(2);
  });

  it('gambles on a face-down shield only when it can pay off', () => {
    const state = scenario({
      // Player 2 holds everything else around player 0.
      knights: { d: { 0: 4 }, tower: { 1: 2 }, hall: { 2: 3 }, keep: { 2: 3 }, h: { 2: 9 } },
      castles: {
        tower: { owner: 1, shield: { value: 0, revealed: false } },
        hall: { owner: 2 },
        keep: { owner: 2 },
      },
    });
    // Half of the shields are zeros: 4 attackers win the tower half the time.
    expect(plan(state).map(describeAction)).toContain('attack tower');
    // The zeros are gone: the shield is 1–3, so 4 attackers lose for sure.
    const hopeless = plan(state, [[], [0, 0, 0], []]).map(describeAction);
    expect(hopeless).not.toContain('attack tower');
  });

  it('keeps shields for valuable castles when few are left', () => {
    const state = scenario({ knights: { tower: { 0: 1 }, keep: { 0: 1 } } });
    expect(wantsShield(state, 'keep')).toBe(true);
    state.shields[0] = [0, 3];
    expect(wantsShield(state, 'keep')).toBe(false);
    expect(wantsShield(state, 'tower')).toBe(true);
    state.shields[0] = [];
    expect(wantsShield(state, 'tower')).toBe(false);
  });
});

describe('heuristic bot', () => {
  it('follows its plan through the turn and places the shield', () => {
    const bot = heuristicBot(1);
    let state = scenario({ knights: { c: { 0: 6 } } });
    const played: string[] = [];
    for (let i = 0; i < 6 && state.current === 0; i++) {
      const action = bot.act({ view: viewFor(state, 0) });
      played.push(describeAction(action));
      if (action.type === 'endTurn') break;
      state = apply(state, action).state;
    }
    expect(played.slice(0, 3)).toEqual(['move c>d', 'attack tower', 'placeShield']);
    expect(played.at(-1)).toBe('endTurn');
  });
});
