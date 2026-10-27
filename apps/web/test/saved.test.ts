import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  GAME_KEY,
  SETTINGS_KEY,
  loadGame,
  loadSettings,
  save,
  saveGame,
  type Store,
} from '../src/game/saved';
import { act, newSession } from '../src/shared/session';

function memory(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('settings', () => {
  it('falls back to the defaults', () => {
    const store = memory();
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.setItem(SETTINGS_KEY, '{ not json');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and drops invalid ones', () => {
    const store = memory();
    save(store, SETTINGS_KEY, { botSpeed: 'fast', animations: 'warp', passScreen: false });
    expect(loadSettings(store)).toEqual({
      ...DEFAULT_SETTINGS,
      botSpeed: 'fast',
      passScreen: false,
    });
  });

  it('remembers the board view and ignores unknown ones', () => {
    const store = memory();
    save(store, SETTINGS_KEY, { view: 'iso' });
    expect(loadSettings(store).view).toBe('iso');
    save(store, SETTINGS_KEY, { view: 'vr' });
    expect(loadSettings(store).view).toBe('3d');
  });
});

describe('saved game', () => {
  it('round-trips the game and its seats', () => {
    const store = memory();
    let session = newSession({ players: 4 }, 42);
    session = act(session, { type: 'roll', player: 0 });
    saveGame(store, { session, seats: ['human', 'easy', 'hard', 'medium'] });
    const loaded = loadGame(store)!;
    expect(loaded.session.state).toEqual(session.state);
    expect(loaded.session.log).toEqual(session.log);
    expect(loaded.seats).toEqual(['human', 'easy', 'hard', 'medium']);
  });

  it('fixes up seats that do not fit the game', () => {
    const store = memory();
    saveGame(store, { session: newSession({ players: 3 }, 1), seats: ['hard'] });
    expect(loadGame(store)!.seats).toEqual(['hard', 'human', 'human']);
  });

  it('ignores missing, broken or illegal games', () => {
    const store = memory();
    expect(loadGame(store)).toBeNull();
    store.setItem(GAME_KEY, 'nope');
    expect(loadGame(store)).toBeNull();
    save(store, GAME_KEY, {
      record: { config: { players: 3 }, seed: 1, actions: [{ type: 'endTurn', player: 0 }] },
    });
    expect(loadGame(store)).toBeNull();
  });

  it('survives a storage that throws', () => {
    const store: Store = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() =>
      saveGame(store, { session: newSession({ players: 3 }, 1), seats: [] }),
    ).not.toThrow();
  });
});
