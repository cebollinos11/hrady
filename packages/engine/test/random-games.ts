import { expect } from 'vitest';
import {
  apply,
  boardContext,
  initialState,
  isTerminal,
  knightsOnBoard,
  legalActions,
  replay,
  validateAction,
  viewFor,
  type Action,
  type GameConfig,
  type GameEvent,
  type GameState,
} from '../src';
import { lcg, type Bot } from './bot';
import { checkInvariants } from './invariants';

export interface GameRun {
  state: GameState;
  actions: Action[];
}

/** Turn cap; reaching it counts as a failure to terminate. */
export const MAX_TURNS = 5000;

/** Knights a batch of events adds to (positive) or removes from the board, per player. */
function knightDelta(events: GameEvent[], players: number): number[] {
  const delta = new Array<number>(players).fill(0);
  for (const e of events) {
    if (e.type === 'knightPlaced') delta[e.player]! += 1;
    if (e.type === 'fieldBattle') delta[e.defender]! -= e.defeated;
    if (e.type === 'castleAttacked') {
      if (!e.won) delta[e.player]! -= e.attackers;
      else if (e.defender !== null) delta[e.defender]! -= e.garrison;
    }
  }
  return delta;
}

/** Identity of an action; the order of attack contributions does not matter. */
function actionKey(action: Action): string {
  if (action.type === 'move') return `move ${action.from} ${action.to} ${action.count}`;
  if (action.type !== 'attackField') return JSON.stringify(action);
  const contributions = [...action.contributions].sort((a, b) => (a.from < b.from ? -1 : 1));
  return JSON.stringify({ ...action, contributions });
}

/**
 * A variation of a legal action: another count, or another node. The engine
 * must accept it exactly when it is in the legal list.
 */
function perturb(action: Action, state: GameState, random: (n: number) => number): Action {
  const ids = boardContext(state.config).order;
  const node = () => ids[random(ids.length)]!;
  const delta = random(2) ? 1 : -1;
  switch (action.type) {
    case 'move':
      return random(2)
        ? { ...action, count: action.count + delta }
        : { ...action, [random(2) ? 'from' : 'to']: node() };
    case 'attackCastle':
      return random(2) ? { ...action, count: action.count + delta } : { ...action, from: node() };
    case 'attackField': {
      const contributions = action.contributions.map((c) => ({ ...c }));
      const c = contributions[random(contributions.length)]!;
      if (random(2)) c.count += delta;
      else c.from = node();
      return { ...action, contributions };
    }
    case 'placeShield':
      return { ...action, castle: node() };
    default:
      return { ...action, player: (action.player + 1) % state.config.players };
  }
}

/**
 * Plays one game with `bot`, checking after every step: invariants, that each
 * listed action is valid, that the validator agrees with the list on nearby
 * actions and knight conservation; on sampled steps also view redaction,
 * input immutability, duplicates and off-turn players.
 */
export function playChecked(config: GameConfig, seed: number, bot: Bot): GameRun {
  const random = lcg(seed ^ 0x5eed);
  let state = initialState(config, seed);
  const actions: Action[] = [];
  const players = state.config.players;
  const fail = (problem: string, detail?: unknown): never => {
    const at = `seed ${seed}, turn ${state.turn}, action ${actions.length}`;
    throw new Error(`${at}: ${problem}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
  };
  const check = (ok: boolean, problem: string, detail?: unknown) => ok || fail(problem, detail);
  const errors = checkInvariants(state);
  check(errors.length === 0, 'invariants', errors);

  while (!isTerminal(state)) {
    if (state.turn > MAX_TURNS) fail(`no end after ${MAX_TURNS} turns`);
    const player = state.current;
    const legal = legalActions(state, player);
    check(legal.length > 0, 'no legal actions');
    for (const a of legal) {
      const reason = validateAction(state, a);
      check(reason === null, `listed action rejected (${reason})`, a);
    }
    const probe = perturb(legal[random(legal.length)]!, state, random);
    const probeKey = actionKey(probe);
    const listed = legal.some((a) => a.type === probe.type && actionKey(a) === probeKey);
    check(
      (validateAction(state, probe) === null) === listed,
      'validator disagrees with list',
      probe,
    );

    // The costlier checks run on a sample of steps.
    const sampled = random(20) === 0;
    if (sampled) {
      for (let other = 0; other < players; other++)
        if (other !== player) check(legalActions(state, other).length === 0, 'off-turn actions');
      check(new Set(legal.map(actionKey)).size === legal.length, 'duplicate legal actions');
    }

    const action = bot(state, legal);
    const before = sampled ? JSON.stringify(state) : null;
    const knightsBefore = knightsOnBoard(state);
    const { state: next, events } = apply(state, action);
    if (before !== null) check(JSON.stringify(state) === before, 'apply mutated its input');

    const errors = checkInvariants(next);
    check(errors.length === 0, `invariants after ${JSON.stringify(action)}`, errors);
    const delta = knightDelta(events, players);
    const knightsAfter = knightsOnBoard(next);
    check(
      knightsAfter.every((n, p) => n === knightsBefore[p]! + delta[p]!),
      'knights appeared or vanished',
      { knightsBefore, knightsAfter, events },
    );
    if (action.type === 'endTurn')
      check(next.current === (player + 1) % players, 'turn did not pass clockwise');

    if (sampled || action.type === 'placeShield') {
      const view = viewFor(next, player);
      check(!('rng' in view), 'view leaks the RNG');
      for (const c of Object.values(view.castles))
        if (c.shield && !c.shield.revealed && c.owner !== player)
          check(c.shield.value === null, 'view leaks a shield');
    }

    actions.push(action);
    state = next;
  }
  return { state, actions };
}

/** Final checks on a finished game: JSON round trip and replay from the log. */
export function checkFinishedGame(config: GameConfig, seed: number, run: GameRun): void {
  const json = JSON.parse(JSON.stringify(run.state)) as GameState;
  expect(json).toEqual(run.state);
  expect(replay(config, seed, run.actions)).toEqual(run.state);
}

/** Games per shard file; `HRADY_GAMES` sets the total across the shards. */
export const SHARDS = 4;
export const GAMES_PER_SHARD = Math.ceil(Number(process.env.HRADY_GAMES ?? 2000) / SHARDS);
