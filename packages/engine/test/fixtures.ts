import type { BoardData, BoardNode, CastleNode, PathNode, StartNode } from '@hrady/board';
import { randomInt } from '../src/rng';
import { initialState, type CastleState, type GameConfig, type GameState } from '../src';

/**
 * A small valid board so rule tests do not depend on the traced Hrady graph:
 *
 *   s1 ─ a ─ b ─ c ─ d ─ h ─ z ─ s4, s5, s6
 *        │   │   │   │   │   └─ castles c04…c18 (1 sword each)
 *   s2 ─ e ─ f ─ g   │   s3
 *            └─keep┘ tower (3), hall (2)
 *
 * `b` has three neighbours (a, c, f) for converging attacks; `keep` (1) is
 * entered from both `c` and `g`, so its owner can walk through it.
 */
export function testBoardData(): BoardData {
  const nodes: BoardNode[] = [];
  const at = (i: number) => ({ x: ((i % 10) + 0.5) / 10, y: (Math.floor(i / 10) + 0.5) / 10 });
  type Spec = Omit<PathNode, 'x' | 'y'> | Omit<StartNode, 'x' | 'y'> | Omit<CastleNode, 'x' | 'y'>;
  const add = (n: Spec) => nodes.push({ ...n, ...at(nodes.length) });

  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'z']) add({ id, type: 'path' });
  for (let n = 1; n <= 6; n++) add({ id: `s${n}`, type: 'start', number: n });
  add({ id: 'keep', type: 'castle', name: 'Keep', value: 1 });
  add({ id: 'tower', type: 'castle', name: 'Tower', value: 3 });
  add({ id: 'hall', type: 'castle', name: 'Hall', value: 2 });
  const filler: string[] = [];
  for (let n = 4; n <= 18; n++) {
    const id = `c${String(n).padStart(2, '0')}`;
    filler.push(id);
    add({ id, type: 'castle', name: `Castle ${n}`, value: 1 });
  }

  const edges: [string, string][] = [
    ['s1', 'a'],
    ['s2', 'e'],
    ['s3', 'h'],
    ['s4', 'z'],
    ['s5', 'z'],
    ['s6', 'z'],
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
    ['d', 'h'],
    ['h', 'z'],
    ['a', 'e'],
    ['e', 'f'],
    ['f', 'b'],
    ['f', 'g'],
    ['keep', 'c'],
    ['keep', 'g'],
    ['tower', 'd'],
    ['hall', 'd'],
    ...filler.map((id): [string, string] => [id, 'z']),
  ];
  return { version: 1, nodes, edges };
}

const testBoard = testBoardData();

export const FILLER_CASTLES = testBoard.nodes
  .filter((n) => n.type === 'castle' && /^c\d+$/.test(n.id))
  .map((n) => n.id);

export interface Scenario {
  players?: number;
  current?: number;
  mp?: number;
  /** `{ node: { player: count } }`. */
  knights?: Record<string, Record<number, number>>;
  castles?: Record<string, Partial<CastleState>>;
  config?: Partial<GameConfig>;
  seed?: number;
}

/** A game on the test board in the move phase, set up as described. */
export function scenario(spec: Scenario = {}): GameState {
  const players = spec.players ?? 3;
  const state = initialState(
    { players, board: testBoard, ...spec.config, firstPlayer: spec.current ?? 0 },
    spec.seed ?? 1,
  );
  state.phase = 'move';
  state.roll = 1;
  state.mp = spec.mp ?? 3;
  for (const [node, byPlayer] of Object.entries(spec.knights ?? {})) {
    const counts = new Array<number>(players).fill(0);
    for (const [p, n] of Object.entries(byPlayer)) counts[Number(p)] = n;
    state.knights[node] = counts;
  }
  for (const [id, c] of Object.entries(spec.castles ?? {})) {
    const castle = { owner: null, shield: null, ...c };
    state.castles[id] = castle;
    // A placed shield comes out of its owner's pool.
    const pool = castle.owner === null ? undefined : state.shields[castle.owner];
    if (castle.shield && pool) pool.splice(pool.indexOf(castle.shield.value), 1);
  }
  return state;
}

/** Sets the RNG so that the next die roll shows `value`. */
export function rigRoll(state: GameState, value: number): GameState {
  for (let rng = 0; ; rng++) {
    if (randomInt(rng, 6)[0] === value - 1) return { ...state, rng };
  }
}
