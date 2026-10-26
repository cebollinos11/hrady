import type { BoardData } from '@hrady/board';

/** Seat index, `0..players-1`, in clockwise turn order. */
export type PlayerId = number;

/** Tunable rule constants. Variants will add flags here. */
export interface RuleOptions {
  /** Movement points per turn. */
  movePoints: number;
  /** Face-down defender shields each player starts with. */
  shieldValues: readonly number[];
}

export const DEFAULT_RULES: RuleOptions = {
  movePoints: 3,
  shieldValues: [0, 0, 0, 1, 2, 3],
};

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 5;

/** Input to {@link initialState}. */
export interface GameConfig {
  /** Number of players, 3–5. */
  players: number;
  /** Seat that takes the first turn. Defaults to 0. */
  firstPlayer?: number;
  /** Board graph. Defaults to the Hrady board from `@hrady/board`. */
  board?: BoardData;
  rules?: Partial<RuleOptions>;
}

/** {@link GameConfig} with defaults filled in, as stored in the state. */
export interface ResolvedConfig {
  players: number;
  firstPlayer: PlayerId;
  /** `null` means the Hrady board. */
  board: BoardData | null;
  rules: RuleOptions;
}

export interface Shield {
  value: number;
  /** Turned face up by a failed attack; stays so for the rest of the game. */
  revealed: boolean;
}

export interface CastleState {
  /** `null` while the castle has never been conquered. */
  owner: PlayerId | null;
  shield: Shield | null;
}

/**
 * `roll`: the current player must roll. `move`: the player spends movement
 * points until they end the turn. `over`: the game has ended.
 */
export type Phase = 'roll' | 'move' | 'over';

/** Full game state. Plain JSON; never mutated by the engine. */
export interface GameState {
  config: ResolvedConfig;
  /** PRNG state, see `rng.ts`. Hidden from players. */
  rng: number;
  /** 1-based turn counter. */
  turn: number;
  current: PlayerId;
  phase: Phase;
  /** Die value of the current turn, `null` before the roll. */
  roll: number | null;
  /** Movement points left this turn. */
  mp: number;
  /**
   * Knights per occupied node: `knights[node][player]` is that player's count.
   * Nodes without knights have no entry. Only start areas hold more than one
   * colour.
   */
  knights: Record<string, number[]>;
  /** Every castle on the board. */
  castles: Record<string, CastleState>;
  /** Shields each player has not placed yet (values, hidden from others). */
  shields: number[][];
  /** Castle just conquered by the current player, which may get a shield now. */
  pendingShield: string | null;
  /** Set when the game is over. */
  end: { player: PlayerId; lastCastle: string } | null;
}

export interface Contribution {
  from: string;
  count: number;
}

export type Action =
  | { type: 'roll'; player: PlayerId }
  | { type: 'move'; player: PlayerId; from: string; to: string; count: number }
  | { type: 'attackField'; player: PlayerId; target: string; contributions: Contribution[] }
  | { type: 'attackCastle'; player: PlayerId; castle: string; from: string; count: number }
  | { type: 'placeShield'; player: PlayerId; castle: string }
  | { type: 'endTurn'; player: PlayerId };

export type ActionType = Action['type'];

/** What happened while applying an action. Events never carry hidden values. */
export type GameEvent =
  | { type: 'rolled'; player: PlayerId; value: number }
  | { type: 'knightPlaced'; player: PlayerId; start: string }
  | { type: 'placementSkipped'; player: PlayerId; start: string }
  | { type: 'moved'; player: PlayerId; from: string; to: string; count: number }
  | {
      type: 'fieldBattle';
      player: PlayerId;
      target: string;
      contributions: Contribution[];
      defender: PlayerId;
      /** Defending knights, all returned to supply. */
      defeated: number;
    }
  | {
      type: 'castleAttacked';
      player: PlayerId;
      castle: string;
      from: string;
      /** Knights on the attacking marker. On a loss all of them return to supply. */
      attackers: number;
      /** `null` for a neutral castle. */
      defender: PlayerId | null;
      /** Defending knights; for a neutral castle, its sword value. */
      garrison: number;
      /** Revealed shield value, `null` when the castle has no shield. */
      shield: number | null;
      won: boolean;
    }
  | {
      type: 'castleConquered';
      player: PlayerId;
      castle: string;
      previousOwner: PlayerId | null;
      /** Knights that moved in. */
      count: number;
    }
  | { type: 'shieldPlaced'; player: PlayerId; castle: string }
  | { type: 'turnEnded'; player: PlayerId; next: PlayerId }
  | {
      type: 'gameOver';
      player: PlayerId;
      lastCastle: string;
      points: number[];
      winners: PlayerId[];
    };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

export interface ShieldView {
  /** `null` when hidden from the viewer. */
  value: number | null;
  revealed: boolean;
}

export interface CastleView {
  owner: PlayerId | null;
  shield: ShieldView | null;
}

/** What one player (or a spectator) may see. No RNG, no hidden shield values. */
export interface GameView {
  /** `null` for a spectator. */
  viewer: PlayerId | null;
  config: ResolvedConfig;
  turn: number;
  current: PlayerId;
  phase: Phase;
  roll: number | null;
  mp: number;
  knights: Record<string, number[]>;
  castles: Record<string, CastleView>;
  /** Shields left per player. */
  shieldsLeft: number[];
  /** The viewer's own unplaced shield values; `null` for a spectator. */
  ownShields: number[] | null;
  pendingShield: string | null;
  end: { player: PlayerId; lastCastle: string } | null;
}

export interface Score {
  /** Swords of held castles, plus the last neutral castle for the player who ended the game. */
  points: number[];
  /** Knights on the board (start areas, path markers and castles): the tiebreak. */
  knights: number[];
  /** Highest points, then most knights. Several entries on a full tie. */
  winners: PlayerId[];
}
