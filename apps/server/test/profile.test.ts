import { MAX_PROFILE_GAMES } from '@hrady/protocol';
import { describe, expect, it } from 'vitest';
import { addGame, forgetGame } from '../src/profile';

const game = (code: string, token = 'token-' + code) => ({ code, token });

describe('profile games', () => {
  it('puts the newest first and keeps one entry per room', () => {
    let games = addGame([], game('AAAAA'));
    games = addGame(games, game('BBBBB'));
    games = addGame(games, game('AAAAA', 'new-token-1'));
    expect(games).toEqual([game('AAAAA', 'new-token-1'), game('BBBBB')]);
  });

  it('forgets a room and caps the list', () => {
    let games: ReturnType<typeof addGame> = [];
    for (let i = 0; i < MAX_PROFILE_GAMES + 5; i++) games = addGame(games, game(`R${i}XYZ`));
    expect(games).toHaveLength(MAX_PROFILE_GAMES);
    expect(games[0]!.code).toBe(`R${MAX_PROFILE_GAMES + 4}XYZ`);
    expect(forgetGame(games, games[0]!.code)).toHaveLength(MAX_PROFILE_GAMES - 1);
    expect(forgetGame(games, 'NOPE1')).toEqual(games);
  });
});
