import { seatsFor, type Seat } from '../shared/seats';
import { fromRecord, type Session } from '../shared/session';

/** Keys in `localStorage`; the 2D debug client keeps its own game separately. */
export const GAME_KEY = 'hrady-game';
export const SETTINGS_KEY = 'hrady-settings';

export type Speed = 'slow' | 'normal' | 'fast';
export type Animations = 'normal' | 'fast' | 'off';

export interface Settings {
  /** How long bots wait before each action. */
  botSpeed: Speed;
  animations: Animations;
  /** Cover the board when it passes between two humans at this screen. */
  passScreen: boolean;
  labels: boolean;
  /** Arrows for what the other players did since your last turn. */
  trails: boolean;
  /** The 3D scene or the isometric pixel-art view. */
  view: '3d' | 'iso';
}

export const DEFAULT_SETTINGS: Settings = {
  botSpeed: 'normal',
  animations: 'normal',
  passScreen: true,
  labels: true,
  trails: true,
  view: '3d',
};

export const BOT_DELAY: Record<Speed, number> = { slow: 1400, normal: 650, fast: 150 };
export const ANIMATION_SPEED: Record<Animations, number> = { normal: 1, fast: 0.45, off: 0 };

/** The subset of `Storage` used here, so tests can pass a map. */
export type Store = Pick<Storage, 'getItem' | 'setItem'>;

function read(store: Store, key: string): unknown {
  try {
    return JSON.parse(store.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Settings from storage, with defaults for anything missing or invalid. */
export function loadSettings(store: Store): Settings {
  const raw = read(store, SETTINGS_KEY);
  const s = isObject(raw) ? raw : {};
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  return {
    botSpeed: pick(s.botSpeed, ['slow', 'normal', 'fast'], DEFAULT_SETTINGS.botSpeed),
    animations: pick(s.animations, ['normal', 'fast', 'off'], DEFAULT_SETTINGS.animations),
    passScreen: pick(s.passScreen, [true, false], DEFAULT_SETTINGS.passScreen),
    labels: pick(s.labels, [true, false], DEFAULT_SETTINGS.labels),
    trails: pick(s.trails, [true, false], DEFAULT_SETTINGS.trails),
    view: pick(s.view, ['3d', 'iso'], DEFAULT_SETTINGS.view),
  };
}

export interface SavedGame {
  session: Session;
  seats: Seat[];
}

/** The saved game, replayed from its record; `null` if there is none or it no longer replays. */
export function loadGame(store: Store): SavedGame | null {
  const raw = read(store, GAME_KEY);
  if (!isObject(raw) || !isObject(raw.record)) return null;
  try {
    const session = fromRecord(raw.record as unknown as Session['record']);
    return { session, seats: seatsFor(session.state.config.players, raw.seats) };
  } catch {
    return null;
  }
}

/** Saving is a convenience: a full or blocked storage is ignored. */
export function save(store: Store, key: string, value: unknown) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore.
  }
}

export const saveGame = (store: Store, game: SavedGame) =>
  save(store, GAME_KEY, { record: game.session.record, seats: game.seats });
