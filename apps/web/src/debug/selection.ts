import { legalActions, type Action, type GameState, type PlayerId } from '@hrady/engine';

/**
 * What the player has picked on the board:
 * - `stack`: own knights on `from`, `count` of them to send somewhere;
 * - `attack`: a field attack on `target` being put together. `contributions`
 *   lists every possible source in board order, 0 for those not taking part.
 */
export type Selection =
  | { kind: 'none' }
  | { kind: 'stack'; from: string; count: number }
  | { kind: 'attack'; target: string; contributions: Record<string, number> };

export const NONE: Selection = { kind: 'none' };

/** Legal choices of the current player, indexed for the board UI. */
export interface Options {
  player: PlayerId;
  roll: boolean;
  endTurn: boolean;
  /** Castle that may get a shield now. */
  shield: string | null;
  /** Most knights each own stack can send anywhere (castles keep one back). */
  movable: Map<string, number>;
  /** `from` → nodes a plain move can reach. */
  moves: Map<string, Set<string>>;
  /** `from` → castles that can be attacked from that entrance marker. */
  castles: Map<string, Set<string>>;
  /** Enemy marker → most knights each node may send in a legal field attack on it. */
  fields: Map<string, Map<string, number>>;
}

function add<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(value);
}

const raise = <K>(map: Map<K, number>, key: K, n: number) =>
  map.set(key, Math.max(map.get(key) ?? 0, n));

/** Indexes `legalActions` of the player to move. */
export function optionsFor(state: GameState): Options {
  const options: Options = {
    player: state.current,
    roll: false,
    endTurn: false,
    shield: null,
    movable: new Map(),
    moves: new Map(),
    castles: new Map(),
    fields: new Map(),
  };
  for (const a of legalActions(state, state.current)) {
    switch (a.type) {
      case 'roll':
        options.roll = true;
        break;
      case 'endTurn':
        options.endTurn = true;
        break;
      case 'placeShield':
        options.shield = a.castle;
        break;
      case 'move':
        add(options.moves, a.from, a.to);
        raise(options.movable, a.from, a.count);
        break;
      case 'attackCastle':
        add(options.castles, a.from, a.castle);
        raise(options.movable, a.from, a.count);
        break;
      case 'attackField': {
        let sources = options.fields.get(a.target);
        if (!sources) options.fields.set(a.target, (sources = new Map()));
        for (const { from, count } of a.contributions) {
          raise(sources, from, count);
          raise(options.movable, from, count);
        }
        break;
      }
    }
  }
  return options;
}

export interface Targets {
  moves: ReadonlySet<string>;
  castles: ReadonlySet<string>;
  /** Enemy markers this stack can take part in attacking. */
  fields: ReadonlySet<string>;
}

/** Where a stack on `from` may go. */
export function targetsFor(options: Options, from: string): Targets {
  const fields = new Set<string>();
  for (const [target, sources] of options.fields) if (sources.has(from)) fields.add(target);
  return {
    moves: options.moves.get(from) ?? new Set(),
    castles: options.castles.get(from) ?? new Set(),
    fields,
  };
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function selectStack(options: Options, from: string): Selection {
  const max = options.movable.get(from);
  return max ? { kind: 'stack', from, count: max } : NONE;
}

/** Starts building an attack on `target`, with `from` sending `count` if given. */
function startAttack(options: Options, target: string, from?: string, count = 0): Selection {
  const sources = options.fields.get(target);
  if (!sources) return NONE;
  const contributions: Record<string, number> = {};
  for (const [source, max] of sources)
    contributions[source] = source === from ? clamp(count, 0, max) : 0;
  return { kind: 'attack', target, contributions };
}

/** Selection with nothing picked yet: a click on an own stack or an enemy marker. */
function pick(options: Options, node: string): Selection {
  if (options.movable.has(node)) return selectStack(options, node);
  return startAttack(options, node);
}

export interface ClickResult {
  selection: Selection;
  /** Set when the click completes an action. */
  action?: Action;
}

/**
 * Handles a click on a board node.
 *
 * With a stack selected, a click on a move target moves it, on a castle attacks
 * it, and on an enemy marker starts a field attack with that stack in it. While
 * building an attack, clicking a possible source toggles it in or out (with all
 * it can send) and clicking the target confirms when `valid`. Anything else
 * starts over with the clicked node.
 */
export function click(
  selection: Selection,
  options: Options,
  node: string,
  valid: (action: Action) => boolean = () => true,
): ClickResult {
  const player = options.player;
  switch (selection.kind) {
    case 'none':
      return { selection: pick(options, node) };

    case 'stack': {
      const { from, count } = selection;
      if (node === from) return { selection: NONE };
      const targets = targetsFor(options, from);
      if (targets.moves.has(node))
        return { selection: NONE, action: { type: 'move', player, from, to: node, count } };
      if (targets.castles.has(node))
        return {
          selection: NONE,
          action: { type: 'attackCastle', player, castle: node, from, count },
        };
      if (targets.fields.has(node)) return { selection: startAttack(options, node, from, count) };
      return { selection: pick(options, node) };
    }

    case 'attack': {
      const { target, contributions } = selection;
      if (node in contributions) {
        const max = options.fields.get(target)?.get(node) ?? 0;
        return {
          selection: setContribution(selection, options, node, contributions[node] ? 0 : max),
        };
      }
      if (node === target) {
        const action = attackAction(selection, player);
        if (action && valid(action)) return { selection: NONE, action };
        return { selection };
      }
      return { selection: pick(options, node) };
    }
  }
}

/** Changes how many knights the selected stack sends (at least 1). */
export function setCount(selection: Selection, options: Options, count: number): Selection {
  if (selection.kind !== 'stack') return selection;
  const max = options.movable.get(selection.from) ?? 1;
  return { ...selection, count: clamp(Math.round(count), 1, max) };
}

/** Changes how many knights `from` sends into the attack (0 = not taking part). */
export function setContribution(
  selection: Selection,
  options: Options,
  from: string,
  count: number,
): Selection {
  if (selection.kind !== 'attack' || !(from in selection.contributions)) return selection;
  const max = options.fields.get(selection.target)?.get(from) ?? 0;
  return {
    ...selection,
    contributions: { ...selection.contributions, [from]: clamp(Math.round(count), 0, max) },
  };
}

/** The field attack being built, or `null` while no source takes part. */
export function attackAction(selection: Selection, player: PlayerId): Action | null {
  if (selection.kind !== 'attack') return null;
  const contributions = Object.entries(selection.contributions)
    .filter(([, count]) => count > 0)
    .map(([from, count]) => ({ from, count }));
  if (!contributions.length) return null;
  return { type: 'attackField', player, target: selection.target, contributions };
}
