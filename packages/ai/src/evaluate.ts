import {
  boardContext,
  score,
  type BoardContext,
  type GameState,
  type PlayerId,
} from '@hrady/engine';
import { distances } from './distances';

/** Tunable weights of {@link evaluate}. */
export interface Weights {
  /** Per sword of a held castle. */
  sword: number;
  /** Per knight on the board. */
  knight: number;
  /** Share of a castle's swords counted as lost when an enemy can take it next turn. */
  castleRisk: number;
  /** Share of a stack counted as lost when an enemy can beat it next turn. */
  exposure: number;
  /** Per sword of the castles a player's stacks are closing in on. */
  potential: number;
  /** A target whose knights are `d` steps from gathering counts `decay ** d`. */
  decay: number;
  /** The `k`-th best target (from 0) counts `focus ** k` in the potential. */
  focus: number;
  /** Opponents are compared by `(1 - leader) * mean + leader * max` of their values. */
  leader: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  sword: 10,
  knight: 1,
  castleRisk: 0.5,
  exposure: 0.7,
  potential: 6,
  decay: 0.85,
  focus: 0.5,
  leader: 0.5,
};

/** Whose eyes a state is evaluated through. */
export interface Perspective {
  player: PlayerId;
  /**
   * Expected value of each player's face-down shield as `player` sees it
   * (`expectedShields`). Other players' face-down values in the state are
   * never read, so a determinized state cannot leak into the evaluation.
   */
  shields: readonly number[];
  weights: Weights;
}

/** Score of a finished game: a win (shared on a tie) dwarfs everything else. */
export const WIN = 1000;

/**
 * Value of the state for `persp.player`: their {@link playerValues} minus a
 * blend of the opponents' mean and best. Higher is better.
 */
export function evaluate(state: GameState, persp: Perspective): number {
  if (state.phase === 'over') {
    const { points, winners } = score(state);
    const best = Math.max(...points.filter((_, p) => p !== persp.player));
    const margin = points[persp.player]! - best;
    return winners.includes(persp.player) ? WIN / winners.length + margin : -WIN + margin;
  }
  const values = playerValues(state, persp);
  const others = values.filter((_, p) => p !== persp.player);
  const mean = others.reduce((a, b) => a + b, 0) / others.length;
  const { leader } = persp.weights;
  return values[persp.player]! - ((1 - leader) * mean + leader * Math.max(...others));
}

const decayTables = new Map<number, Float64Array>();

/** `decay ** d` for every distance a target is still worth walking. */
function decayTable(decay: number): Float64Array {
  let table = decayTables.get(decay);
  if (!table)
    decayTables.set(decay, (table = Float64Array.from({ length: 40 }, (_, d) => decay ** d)));
  return table;
}

/** Board tables for the evaluation, built once per board. */
interface Tables {
  /** 0 path, 1 start, 2 castle, by node index. */
  kind: Uint8Array;
  castles: { id: string; swords: number; entrances: number[] }[];
}

const tableCache = new WeakMap<BoardContext, Tables>();

function tables(ctx: BoardContext): Tables {
  let t = tableCache.get(ctx);
  if (t) return t;
  const dist = distances(ctx);
  const kind = new Uint8Array(ctx.order.length);
  ctx.order.forEach((id, i) => {
    kind[i] = ctx.type(id) === 'path' ? 0 : ctx.type(id) === 'start' ? 1 : 2;
  });
  const castles = ctx.castleIds.map((id) => ({
    id,
    swords: ctx.castleValue(id),
    entrances: ctx
      .neighbours(id)
      .filter((e) => ctx.type(e) === 'path')
      .map((e) => dist.index(e)),
  }));
  t = { kind, castles };
  tableCache.set(ctx, t);
  return t;
}

/**
 * Heuristic value of each player's position, as `persp.player` sees it:
 * castle swords (minus those an enemy can take next turn), knights on the
 * board (minus stacks an enemy can beat next turn) and the potential of their
 * stacks to take further castles (consolidation and closeness; an entrance
 * held by someone else must be fought through, so blocking it counts).
 */
export function playerValues(state: GameState, persp: Perspective): number[] {
  const ctx = boardContext(state.config);
  const dist = distances(ctx);
  const { kind, castles } = tables(ctx);
  const w = persp.weights;
  const players = state.config.players;
  const budget = state.config.rules.movePoints;
  const decay = decayTable(w.decay);

  // Stacks per player (knights that can leave a node), who holds each node.
  const stackNode: number[][] = Array.from({ length: players }, () => []);
  const stackFree: number[][] = Array.from({ length: players }, () => []);
  const knights = new Array<number>(players).fill(0);
  const heldBy = new Int8Array(kind.length).fill(-1);
  const heldN = new Int32Array(kind.length);
  for (const id in state.knights) {
    const counts = state.knights[id]!;
    const node = dist.index(id);
    for (let p = 0; p < players; p++) {
      const n = counts[p]!;
      if (n === 0) continue;
      knights[p]! += n;
      const free = kind[node] === 2 ? n - 1 : n;
      if (free > 0) {
        stackNode[p]!.push(node);
        stackFree[p]!.push(free);
      }
      if (kind[node] !== 1) {
        heldBy[node] = p;
        heldN[node] = n;
      }
    }
  }

  /** Most knights `attacker` can bring to `node` spending at most `mp` steps in total. */
  const best = new Array<number>(budget + 1);
  const reach = (attacker: PlayerId, node: number, mp: number): number => {
    best.fill(0);
    const nodes = stackNode[attacker]!;
    const free = stackFree[attacker]!;
    for (let i = 0; i < nodes.length; i++) {
      const cost = dist.at(nodes[i]!, node);
      if (cost > mp) continue;
      for (let b = mp; b >= cost; b--) best[b] = Math.max(best[b]!, best[b - cost]! + free[i]!);
    }
    return best[mp]!;
  };

  const castleSwords = new Array<number>(players).fill(0);
  const riskSwords = new Array<number>(players).fill(0);
  const targets = Array.from({ length: players }, () => new Float64Array(castles.length));
  const closeness = new Array<number>(players);
  // Knights per distance from an entrance, for one player.
  const near = new Float64Array(decay.length);

  for (const [ci, { id, swords, entrances }] of castles.entries()) {
    const c = state.castles[id]!;
    const owner = c.owner;
    let need = 2 * swords;
    if (owner !== null) {
      castleSwords[owner]! += swords;
      let defence = state.knights[id]?.[owner] ?? 0;
      if (c.shield) {
        const visible = c.shield.revealed || owner === persp.player;
        defence += visible ? c.shield.value : persp.shields[owner]!;
      }
      need = 2 * defence;
    }

    let risk = 0;
    closeness.fill(0);
    for (const entrance of entrances) {
      const holder = heldBy[entrance]!;
      for (let p = 0; p < players; p++) {
        if (p === owner) continue;
        // A stack of someone else on the entrance has to be beaten first.
        const blocker = holder >= 0 && holder !== p ? heldN[entrance]! : 0;
        const needHere = Math.max(need, blocker + 1);
        if (owner !== null && risk < 1) {
          // Can `p` attack it next turn: gather on the entrance and keep 1 MP?
          const force = reach(p, entrance, budget - 1);
          risk = Math.max(risk, force >= needHere ? 1 : force === needHere - 1 ? 0.3 : 0);
        }
        // How close `p` is to taking it: gather the nearest stacks until
        // they are strong enough; the farthest one needed sets the time.
        const nodes = stackNode[p]!;
        const free = stackFree[p]!;
        let far = -1;
        for (let i = 0; i < nodes.length; i++) {
          const d = dist.at(nodes[i]!, entrance);
          if (d >= near.length) continue;
          near[d]! += free[i]!;
          if (d > far) far = d;
        }
        let force = 0;
        for (let d = 0; d <= far; d++) {
          if (near[d] === 0) continue;
          force += near[d]!;
          near[d] = 0;
          const f = Math.min(1, force / needHere);
          const value = f * f * decay[d]!;
          if (value > closeness[p]!) closeness[p] = value;
          if (f === 1) {
            near.fill(0, d + 1, far + 1);
            break;
          }
        }
      }
    }
    for (let p = 0; p < players; p++) if (p !== owner) targets[p]![ci] = swords * closeness[p]!;
    if (owner !== null) riskSwords[owner]! += swords * risk;
  }

  const exposed = new Array<number>(players).fill(0);
  for (let node = 0; node < kind.length; node++) {
    const player = heldBy[node]!;
    if (player < 0 || kind[node] !== 0) continue;
    for (let p = 0; p < players; p++) {
      if (p !== player && reach(p, node, budget) > heldN[node]!) {
        exposed[player]! += heldN[node]!;
        break;
      }
    }
  }

  return Array.from({ length: players }, (_, p) => {
    const sorted = targets[p]!.sort();
    let potential = 0;
    for (let k = sorted.length - 1, f = 1; k >= 0 && sorted[k]! > 0.01; k--, f *= w.focus)
      potential += f * sorted[k]!;
    return (
      w.sword * (castleSwords[p]! - w.castleRisk * riskSwords[p]!) +
      w.knight * (knights[p]! - w.exposure * exposed[p]!) +
      w.potential * potential
    );
  });
}
