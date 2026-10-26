import { describe, expect, it } from 'vitest';
import { apply, legalActions, validateAction, viewFor, type Action, type GameState } from '../src';
import { scenario } from './fixtures';

const field = (target: string, ...contributions: [string, number][]): Action => ({
  type: 'attackField',
  player: 0,
  target,
  contributions: contributions.map(([from, count]) => ({ from, count })),
});
const castle = (name: string, from: string, count: number): Action => ({
  type: 'attackCastle',
  player: 0,
  castle: name,
  from,
  count,
});
const run = (state: GameState, ...actions: Action[]) =>
  actions.reduce((s, a) => apply(s, a).state, state);

describe('field battles', () => {
  it('needs at least one knight more than the defenders', () => {
    const state = scenario({ knights: { a: { 0: 3 }, b: { 1: 3 } } });
    expect(validateAction(state, field('b', ['a', 3]))).toMatch(/do not outnumber/);
    const four = scenario({ knights: { a: { 0: 4 }, b: { 1: 3 } } });
    expect(validateAction(four, field('b', ['a', 4]))).toBeNull();
    expect(validateAction(four, field('b', ['a', 3]))).toMatch(/do not outnumber/);
  });

  it('sends the defenders to supply and occupies the marker for 1 MP', () => {
    const { state, events } = apply(
      scenario({ knights: { a: { 0: 3 }, b: { 1: 2 } } }),
      field('b', ['a', 3]),
    );
    expect(state.knights).toEqual({ b: [3, 0, 0] });
    expect(state.mp).toBe(2);
    expect(events).toEqual([
      {
        type: 'fieldBattle',
        player: 0,
        target: 'b',
        contributions: [{ from: 'a', count: 3 }],
        defender: 1,
        defeated: 2,
      },
    ]);
  });

  it('may leave knights behind', () => {
    const state = run(scenario({ knights: { a: { 0: 5 }, b: { 1: 2 } } }), field('b', ['a', 3]));
    expect(state.knights).toEqual({ a: [2, 0, 0], b: [3, 0, 0] });
  });

  it('combines knights from several directions, 1 MP per direction', () => {
    const start = scenario({ knights: { a: { 0: 1 }, c: { 0: 1 }, f: { 0: 1 }, b: { 1: 2 } } });
    const { state } = apply(start, field('b', ['a', 1], ['c', 1], ['f', 1]));
    expect(state.knights).toEqual({ b: [3, 0, 0] });
    expect(state.mp).toBe(0);

    // Any two directions are not enough, and three need all 3 MP.
    expect(validateAction(start, field('b', ['a', 1], ['c', 1]))).toMatch(/do not outnumber/);
    const twoMp = { ...start, mp: 2 };
    expect(validateAction(twoMp, field('b', ['a', 1], ['c', 1], ['f', 1]))).toMatch(
      /3 MP, only 2 left/,
    );
    expect(legalActions(twoMp, 0).some((a) => a.type === 'attackField')).toBe(false);
  });

  it('counts earlier moves against the same 3 MP budget', () => {
    // e → f costs 1 MP, leaving 2 for a two-direction attack.
    const state = run(
      scenario({ knights: { a: { 0: 2 }, e: { 0: 1 }, b: { 1: 2 } } }),
      { type: 'move', player: 0, from: 'e', to: 'f', count: 1 },
      field('b', ['a', 2], ['f', 1]),
    );
    expect(state.knights).toEqual({ b: [3, 0, 0] });
    expect(state.mp).toBe(0);
  });

  it('lets the winners keep moving with the MP left', () => {
    const state = run(scenario({ knights: { a: { 0: 2 }, b: { 1: 1 } } }), field('b', ['a', 2]), {
      type: 'move',
      player: 0,
      from: 'b',
      to: 'c',
      count: 2,
    });
    expect(state.knights).toEqual({ c: [2, 0, 0] });
    expect(state.mp).toBe(1);
  });

  it('can draw on an own castle garrison but must leave one knight', () => {
    const state = scenario({
      knights: { keep: { 0: 3 }, c: { 1: 2 } },
      castles: { keep: { owner: 0 } },
    });
    expect(validateAction(state, field('c', ['keep', 3]))).toMatch(/1–2 knights/);
    expect(validateAction(state, field('c', ['keep', 2]))).toMatch(/do not outnumber/);
    const strong = scenario({
      knights: { keep: { 0: 4 }, c: { 1: 2 } },
      castles: { keep: { owner: 0 } },
    });
    expect(run(strong, field('c', ['keep', 3])).knights).toEqual({
      keep: [1, 0, 0],
      c: [3, 0, 0],
    });
  });

  it('happens only on enemy-held path markers', () => {
    const state = scenario({ knights: { a: { 0: 5 }, s1: { 1: 1 }, b: { 0: 1 } } });
    expect(validateAction(state, field('s1', ['a', 5]))).toMatch(/only on path markers/);
    expect(validateAction(state, field('b', ['a', 5]))).toMatch(/no enemy knights/);
    expect(validateAction(state, field('e', ['a', 5]))).toMatch(/no enemy knights/);
  });

  it('rejects bad contributions', () => {
    const state = scenario({ knights: { a: { 0: 3 }, h: { 0: 3 }, b: { 1: 1 } } });
    expect(validateAction(state, field('b'))).toMatch(/at least one/);
    expect(validateAction(state, field('b', ['h', 3]))).toMatch(/not adjacent/);
    expect(validateAction(state, field('b', ['a', 1], ['a', 1]))).toMatch(/twice/);
    expect(validateAction(state, field('b', ['a', 4]))).toMatch(/1–3/);
    expect(validateAction(state, field('b', ['f', 1]))).toMatch(/1–0/);
  });

  it('lists every winning combination of directions and counts', () => {
    const state = scenario({ knights: { a: { 0: 2 }, c: { 0: 1 }, b: { 1: 1 } } });
    const attacks = legalActions(state, 0).filter((a) => a.type === 'attackField');
    expect(attacks).toEqual([
      field('b', ['a', 2]),
      field('b', ['a', 1], ['c', 1]),
      field('b', ['a', 2], ['c', 1]),
    ]);
  });
});

describe('neutral castles', () => {
  it('fall to twice their swords on the entrance marker', () => {
    const five = scenario({ knights: { d: { 0: 5 } } });
    expect(validateAction(five, castle('tower', 'd', 1))).toMatch(/5 knights on d, at least 6/);
    const six = scenario({ knights: { d: { 0: 6 } } });
    const { state, events } = apply(six, castle('tower', 'd', 1));
    expect(state.castles.tower).toEqual({ owner: 0, shield: null });
    expect(state.knights).toEqual({ d: [5, 0, 0], tower: [1, 0, 0] });
    expect(state.mp).toBe(2);
    expect(events).toEqual([
      {
        type: 'castleAttacked',
        player: 0,
        castle: 'tower',
        from: 'd',
        attackers: 6,
        defender: null,
        garrison: 3,
        shield: null,
        won: true,
      },
      { type: 'castleConquered', player: 0, castle: 'tower', previousOwner: null, count: 1 },
    ]);
  });

  it('take as many knights inside as the attacker chooses', () => {
    const state = run(scenario({ knights: { d: { 0: 6 } } }), castle('tower', 'd', 6));
    expect(state.knights).toEqual({ tower: [6, 0, 0] });
  });

  it('need a movement point left', () => {
    const state = scenario({ mp: 0, knights: { d: { 0: 6 } } });
    expect(validateAction(state, castle('tower', 'd', 1))).toMatch(/no movement points/);
  });

  it('are attacked only from their entrance marker', () => {
    const state = scenario({ knights: { c: { 0: 6 }, s1: { 0: 6 } } });
    expect(validateAction(state, castle('tower', 'c', 1))).toMatch(/not an entrance/);
    expect(validateAction(state, castle('keep', 's1', 1))).toMatch(/not an entrance/);
    expect(validateAction(state, castle('c', 'b', 1))).toMatch(/not a castle/);
  });

  it('do not need the attacking knights to have moved this turn', () => {
    const state = run(
      scenario({ knights: { c: { 0: 2 } } }),
      { type: 'move', player: 0, from: 'c', to: 'd', count: 2 },
      { type: 'move', player: 0, from: 'd', to: 'c', count: 2 },
      castle('keep', 'c', 2),
    );
    expect(state.castles.keep?.owner).toBe(0);
    expect(state.mp).toBe(0);
  });
});

describe('shields', () => {
  const conquered = () => run(scenario({ knights: { d: { 0: 6 } } }), castle('tower', 'd', 1));
  const place: Action = { type: 'placeShield', player: 0, castle: 'tower' };

  it('may be placed right after a conquest', () => {
    const state = conquered();
    expect(state.pendingShield).toBe('tower');
    expect(legalActions(state, 0)[0]).toEqual(place);
    const { state: next, events } = apply(state, place);
    expect(events).toEqual([{ type: 'shieldPlaced', player: 0, castle: 'tower' }]);
    const shield = next.castles.tower!.shield!;
    expect(shield.revealed).toBe(false);
    expect(next.shields[0]).toHaveLength(5);
    expect([...next.shields[0]!, shield.value].sort()).toEqual([0, 0, 0, 1, 2, 3]);
    expect(next.pendingShield).toBeNull();
    expect(validateAction(next, place)).toMatch(/right after/);
  });

  it('are drawn at random from the remaining ones', () => {
    const drawn = new Set<number>();
    for (let seed = 0; seed < 100; seed++) {
      const state = run(
        scenario({ seed, knights: { d: { 0: 6 } } }),
        castle('tower', 'd', 1),
        place,
      );
      drawn.add(state.castles.tower!.shield!.value);
    }
    expect([...drawn].sort()).toEqual([0, 1, 2, 3]);
  });

  it('are optional: any other action skips the placement', () => {
    const state = run(conquered(), { type: 'move', player: 0, from: 'd', to: 'h', count: 5 });
    expect(state.pendingShield).toBeNull();
    expect(validateAction(state, place)).toMatch(/right after/);
    expect(state.castles.tower!.shield).toBeNull();
  });

  it('are not offered once all six are used', () => {
    const state = scenario({ knights: { d: { 0: 6 } } });
    state.shields[0] = [];
    const next = run(state, castle('tower', 'd', 1));
    expect(next.pendingShield).toBeNull();
    expect(legalActions(next, 0).some((a) => a.type === 'placeShield')).toBe(false);
  });

  it('stay hidden from other players until revealed', () => {
    const state = run(conquered(), place);
    const value = state.castles.tower!.shield!.value;
    expect(viewFor(state, 0).castles.tower!.shield).toEqual({ value, revealed: false });
    expect(viewFor(state, 1).castles.tower!.shield).toEqual({ value: null, revealed: false });
    expect(viewFor(state, null).castles.tower!.shield).toEqual({ value: null, revealed: false });
  });
});

describe('enemy castles', () => {
  // The rulebook example: 2 knights and a 3 shield need 10 attackers.
  const defended = (attackers: number, revealed = false) =>
    scenario({
      knights: { d: { 0: attackers }, hall: { 1: 2 } },
      castles: { hall: { owner: 1, shield: { value: 3, revealed } } },
    });

  it('fall to twice the garrison plus shield: 10 attackers beat 2 knights and a 3', () => {
    const { state, events } = apply(defended(10), castle('hall', 'd', 4));
    expect(events).toEqual([
      {
        type: 'castleAttacked',
        player: 0,
        castle: 'hall',
        from: 'd',
        attackers: 10,
        defender: 1,
        garrison: 2,
        shield: 3,
        won: true,
      },
      { type: 'castleConquered', player: 0, castle: 'hall', previousOwner: 1, count: 4 },
    ]);
    expect(state.knights).toEqual({ d: [6, 0, 0], hall: [4, 0, 0] });
    expect(state.castles.hall).toEqual({ owner: 0, shield: null });
    // The defender's shield is out of the game, not back in their pool.
    expect(state.shields[1]).toEqual([0, 0, 0, 1, 2]);
    expect(state.pendingShield).toBe('hall');
    expect(state.mp).toBe(2);
  });

  it('cost all attacking knights when too weak: 9 lose, and the shield stays face up', () => {
    const { state, events } = apply(defended(9), castle('hall', 'd', 1));
    expect(events).toEqual([
      expect.objectContaining({ type: 'castleAttacked', attackers: 9, shield: 3, won: false }),
    ]);
    expect(state.knights).toEqual({ hall: [0, 2, 0] });
    expect(state.castles.hall).toEqual({ owner: 1, shield: { value: 3, revealed: true } });
    expect(state.mp).toBe(2);
    expect(viewFor(state, 2).castles.hall!.shield).toEqual({ value: 3, revealed: true });
  });

  it('may be attacked with twice the garrison while the shield is face down', () => {
    expect(validateAction(defended(3), castle('hall', 'd', 1))).toMatch(/at least 4/);
    expect(validateAction(defended(4), castle('hall', 'd', 1))).toBeNull();
  });

  it('count a revealed shield before the attack', () => {
    expect(validateAction(defended(9, true), castle('hall', 'd', 1))).toMatch(/at least 10/);
    expect(validateAction(defended(10, true), castle('hall', 'd', 1))).toBeNull();
  });

  it('without a shield need twice the garrison', () => {
    const state = scenario({
      knights: { d: { 0: 4 }, hall: { 1: 2 } },
      castles: { hall: { owner: 1 } },
    });
    const { events } = apply(state, castle('hall', 'd', 1));
    expect(events[0]).toMatchObject({ shield: null, won: true });
  });

  it('lose the whole attacking stack, but not knights elsewhere', () => {
    const state = run(
      scenario({
        knights: { d: { 0: 4 }, h: { 0: 3 }, hall: { 1: 2 } },
        castles: { hall: { owner: 1, shield: { value: 2, revealed: false } } },
      }),
      castle('hall', 'd', 1),
    );
    expect(state.knights).toEqual({ h: [3, 0, 0], hall: [0, 2, 0] });
  });

  it('are not attacked by their owner', () => {
    const state = scenario({
      knights: { d: { 0: 9 }, hall: { 0: 1 } },
      castles: { hall: { owner: 0 } },
    });
    expect(validateAction(state, castle('hall', 'd', 1))).toMatch(/already yours/);
  });
});
