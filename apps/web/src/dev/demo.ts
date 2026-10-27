import {
  boardContext,
  initialState,
  legalActions,
  type Action,
  type GameState,
  type PlayerId,
} from '@hrady/engine';

/**
 * Hand-made situations that show each animation, for the `?dev=1` demo button.
 * Every stage is a real game state and a list of real actions, so the events
 * (and with them the animations) come from the engine like in a game.
 */

/** One thing that happens in a stage: an action (maybe chosen once the state is known). */
export interface DemoStep {
  action: Action | ((state: GameState) => Action);
  /** Milliseconds to wait before it, to look at the board. */
  pause?: number;
}

export interface DemoStage {
  title: string;
  state: GameState;
  steps: DemoStep[];
  /** Nodes to zoom on; the whole board if empty. */
  focus: string[];
}

const SEED = 7;
const PLAYERS = 3;

const START_ROLLS = [1, 2, 3, 4, 5, 6];

function fresh(): {
  state: GameState;
  starts: string[];
  neighbours: (id: string) => readonly string[];
} {
  const state = initialState({ players: PLAYERS }, SEED);
  const ctx = boardContext(state.config);
  const starts = START_ROLLS.map((n) => ctx.board.startFor(n).id);
  return { state, starts, neighbours: ctx.neighbours };
}

function put(state: GameState, node: string, byPlayer: Partial<Record<PlayerId, number>>) {
  const counts = new Array<number>(PLAYERS).fill(0);
  for (const [p, n] of Object.entries(byPlayer)) counts[Number(p)] = n ?? 0;
  state.knights[node] = counts;
}

function own(state: GameState, castle: string, owner: PlayerId | null, shield?: number) {
  state.castles[castle] = {
    owner,
    shield: shield === undefined ? null : { value: shield, revealed: false },
  };
  const pool = owner === null ? undefined : state.shields[owner];
  if (pool && shield !== undefined) pool.splice(pool.indexOf(shield), 1);
}

/** Ready to move: the roll is done and there are movement points. */
function moving(state: GameState) {
  state.phase = 'move';
  state.roll = 1;
  state.mp = 9;
}

const roll = (player: PlayerId = 0): Action => ({ type: 'roll', player });

/** The first move that takes the player's knight off the start area it must leave. */
const stepOff =
  (player: PlayerId = 0) =>
  (state: GameState): Action => {
    const move = legalActions(state, player).find((a) => a.type === 'move');
    if (!move) throw new Error('no move to step off with');
    return move;
  };

const CASTLE = 'valenice';
const NEAR = 'p05';
const FAR = 'p01';

export function demoStages(): DemoStage[] {
  const stages: DemoStage[] = [];

  {
    const { state } = fresh();
    stages.push({ title: 'Spawn', state, steps: [{ action: roll() }], focus: [] });
  }
  {
    const { state, starts } = fresh();
    for (const s of starts) put(state, s, { 0: 1 });
    stages.push({
      title: 'Spawn onto your own knight',
      state,
      steps: [{ action: roll() }, { action: stepOff(), pause: 1800 }],
      focus: [],
    });
  }
  {
    const { state, starts, neighbours } = fresh();
    for (const s of starts) {
      put(state, s, { 0: 1 });
      for (const n of neighbours(s)) put(state, n, { 1: 1 });
    }
    stages.push({
      title: 'Spawn with nowhere to step',
      state,
      steps: [{ action: roll() }],
      focus: [],
    });
  }
  {
    const { state } = fresh();
    moving(state);
    put(state, NEAR, { 0: 4 });
    put(state, FAR, { 1: 3 });
    stages.push({
      title: 'Field battle',
      state,
      steps: [
        {
          action: {
            type: 'attackField',
            player: 0,
            target: FAR,
            contributions: [{ from: NEAR, count: 4 }],
          },
        },
      ],
      focus: [NEAR, FAR],
    });
  }
  {
    const { state } = fresh();
    moving(state);
    put(state, NEAR, { 0: 6 });
    put(state, CASTLE, { 1: 2 });
    own(state, CASTLE, 1, 3);
    stages.push({
      title: 'Castle attack, shield 3: lost',
      state,
      steps: [
        { action: { type: 'attackCastle', player: 0, castle: CASTLE, from: NEAR, count: 6 } },
      ],
      focus: [NEAR, CASTLE],
    });
  }
  {
    const { state } = fresh();
    moving(state);
    put(state, NEAR, { 0: 12 });
    put(state, CASTLE, { 1: 2 });
    own(state, CASTLE, 1, 2);
    stages.push({
      title: 'Castle attack, shield 2: taken',
      state,
      steps: [
        { action: { type: 'attackCastle', player: 0, castle: CASTLE, from: NEAR, count: 3 } },
      ],
      focus: [NEAR, CASTLE],
    });
  }
  {
    const { state } = fresh();
    moving(state);
    put(state, NEAR, { 0: 8 });
    stages.push({
      title: 'Neutral castle taken',
      state,
      steps: [
        { action: { type: 'attackCastle', player: 0, castle: CASTLE, from: NEAR, count: 2 } },
      ],
      focus: [NEAR, CASTLE],
    });
  }
  return stages;
}
