import { MAX_PROFILE_GAMES, type ProfileGame } from '@hrady/protocol';

/**
 * A username's games, newest first. Pure functions over the stored list; the
 * `Profile` Durable Object (index.ts) only does the storage.
 */

/** Remembers a game (moved to the front if it is already there). */
export function addGame(games: readonly ProfileGame[], game: ProfileGame): ProfileGame[] {
  return [game, ...games.filter((g) => g.code !== game.code)].slice(0, MAX_PROFILE_GAMES);
}

export function forgetGame(games: readonly ProfileGame[], code: string): ProfileGame[] {
  return games.filter((g) => g.code !== code);
}
