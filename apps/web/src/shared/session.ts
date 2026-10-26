import {
  apply,
  initialState,
  type Action,
  type GameConfig,
  type GameEvent,
  type GameState,
} from '@hrady/engine';

/** Everything needed to rebuild a game: the export/import format. */
export interface GameRecord {
  config: GameConfig;
  seed: number;
  actions: Action[];
}

export interface LogEntry {
  action: Action;
  events: GameEvent[];
}

/** A local game: its record, the current state and the events of every action. */
export interface Session {
  record: GameRecord;
  state: GameState;
  log: LogEntry[];
}

export function newSession(config: GameConfig, seed: number): Session {
  return { record: { config, seed, actions: [] }, state: initialState(config, seed), log: [] };
}

/** Applies an action. Throws the engine's `IllegalActionError` if it is not legal. */
export function act(session: Session, action: Action): Session {
  const { state, events } = apply(session.state, action);
  const { record } = session;
  return {
    record: { ...record, actions: [...record.actions, action] },
    state,
    log: [...session.log, { action, events }],
  };
}

/**
 * Rebuilds a session from its record, like the engine's `replay`, keeping the
 * events. Throws if an action is illegal.
 */
export function fromRecord(record: GameRecord): Session {
  return record.actions.reduce(act, newSession(record.config, record.seed));
}

/**
 * Every state of a record, from the initial one (index 0) to the state after
 * the last action (index `actions.length`), for stepping through a replay.
 */
export function frames(record: GameRecord): GameState[] {
  const out = [initialState(record.config, record.seed)];
  for (const action of record.actions) out.push(apply(out[out.length - 1]!, action).state);
  return out;
}

/**
 * Only plain moves can be taken back. A roll, any battle, a shield and the end
 * of a turn draw from the RNG, reveal information or hand over the turn.
 */
export const isReversible = (action: Action) => action.type === 'move';

/** Number of actions up to and including the last irreversible one. */
export function undoFloor(actions: readonly Action[]): number {
  let i = actions.length;
  while (i > 0 && isReversible(actions[i - 1]!)) i--;
  return i;
}

export const canUndo = (session: Session) =>
  undoFloor(session.record.actions) < session.record.actions.length;

/** Takes back the last move by replaying the log without it. */
export function undo(session: Session): Session {
  if (!canUndo(session)) return session;
  return truncate(session, session.record.actions.length - 1);
}

/** Takes back every move since the last irreversible action. */
export function undoTurn(session: Session): Session {
  return truncate(session, undoFloor(session.record.actions));
}

/** The game as it was after its first `length` actions. */
export function truncate(session: Session, length: number): Session {
  const { record } = session;
  return fromRecord({ ...record, actions: record.actions.slice(0, length) });
}

export const exportRecord = (session: Session) => JSON.stringify(session.record, null, 2);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Checks the outline of an imported record and replays it. The engine does the
 * real validation: a bad config or an illegal action throws with its reason.
 */
export function importRecord(json: string): Session {
  const raw: unknown = JSON.parse(json);
  if (!isObject(raw)) throw new Error('expected an object { config, seed, actions }');
  const { config, seed, actions } = raw;
  if (!isObject(config)) throw new Error('config must be an object');
  if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
  if (!Array.isArray(actions) || !actions.every(isObject))
    throw new Error('actions must be an array of objects');
  return fromRecord({
    config: config as unknown as GameConfig,
    seed: seed as number,
    actions: actions as unknown as Action[],
  });
}
