import {
  apply,
  boardContext,
  legalActions,
  validateAction,
  type Action,
  type GameState,
  type PlayerId,
} from '@hrady/engine';

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
  /** The state the options were taken from, for planning paths. */
  state: GameState;
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
    state,
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

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export interface Targets {
  /** Nodes the stack can walk to, in one or more steps. */
  moves: ReadonlySet<string>;
  /** Castles the stack can attack, from where it stands or after walking to an entrance. */
  castles: ReadonlySet<string>;
  /**
   * Enemy markers this stack can take part in attacking: next to it, or
   * after walking next to one it can beat on its own.
   */
  fields: ReadonlySet<string>;
  /** The actions that take the stack to each target it can reach on its own, shortest first. */
  paths: ReadonlyMap<string, Action[]>;
}

/**
 * Every node `count` knights on `from` can reach with the movement points left,
 * and every castle and enemy marker they can attack on the way (on their own),
 * with the actions to get there. Each step is checked against the engine on
 * the state the previous steps lead to, so paths through own castles or start
 * areas follow the rules.
 */
export function pathsFrom(state: GameState, from: string, count: number): Map<string, Action[]> {
  const ctx = boardContext(state.config);
  const player = state.current;
  const out = new Map<string, Action[]>();
  const seen = new Set([from]);
  const queue: { node: string; state: GameState; path: Action[] }[] = [
    { node: from, state, path: [] },
  ];
  for (let item = queue.shift(); item; item = queue.shift()) {
    const { node, path } = item;
    for (const to of ctx.neighbours(node)) {
      const attacks: Action[] = [
        { type: 'attackCastle', player, castle: to, from: node, count },
        { type: 'attackField', player, target: to, contributions: [{ from: node, count }] },
      ];
      for (const attack of attacks)
        if (!out.has(to) && validateAction(item.state, attack) === null)
          out.set(to, [...path, attack]);
      const move: Action = { type: 'move', player, from: node, to, count };
      if (seen.has(to) || validateAction(item.state, move) !== null) continue;
      seen.add(to);
      out.set(to, [...path, move]);
      queue.push({ node: to, state: apply(item.state, move).state, path: [...path, move] });
    }
  }
  return out;
}

/** Where `count` knights of the stack on `from` may go (all it can send by default). */
export function targetsFor(options: Options, from: string, count?: number): Targets {
  const fields = new Set<string>();
  for (const [target, sources] of options.fields) if (sources.has(from)) fields.add(target);
  const max = options.movable.get(from) ?? 0;
  const paths = max
    ? pathsFrom(options.state, from, clamp(count ?? max, 1, max))
    : new Map<string, Action[]>();
  const moves = new Set<string>();
  const castles = new Set<string>();
  for (const [node, path] of paths) {
    const type = path.at(-1)!.type;
    (type === 'move' ? moves : type === 'attackCastle' ? castles : fields).add(node);
  }
  return { moves, castles, fields, paths };
}

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
  /** Set when the click completes a move or attack: the actions to play, in order. */
  actions?: Action[];
}

/**
 * Handles a click on a board node.
 *
 * With a stack selected, a click on a node in reach walks the stack there
 * (several moves if needed) and keeps it selected; a click on a castle in
 * reach walks to its entrance and attacks it; a click on a neighbouring enemy
 * marker starts a field attack with that stack in it, and on one further away
 * walks next to it and attacks. While
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
      if (options.fields.get(node)?.has(from))
        return { selection: startAttack(options, node, from, count) };
      const targets = targetsFor(options, from, count);
      const path = targets.paths.get(node);
      if (path)
        return {
          selection: targets.moves.has(node) ? { kind: 'stack', from: node, count } : NONE,
          actions: path,
        };
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
        if (action && valid(action)) return { selection: NONE, actions: [action] };
        return { selection };
      }
      return { selection: pick(options, node) };
    }
  }
}

/**
 * The selection carried over to new options after an action: a stack stays
 * selected while it can still act, with all its knights again (it may have
 * joined others); anything else is dropped.
 */
export function carryOver(selection: Selection, options: Options): Selection {
  if (selection.kind !== 'stack') return NONE;
  return selectStack(options, selection.from);
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
