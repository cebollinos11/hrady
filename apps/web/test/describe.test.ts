import { parseBoard } from '@hrady/board';
import { describe, expect, it } from 'vitest';
import { testBoardData } from '../../../packages/engine/test/fixtures';
import { describeEvent, nodeName, playerName } from '../src/shared/describe';

const board = parseBoard(testBoardData());

describe('describe', () => {
  it('names players and nodes', () => {
    expect(playerName(0)).toBe('Red');
    expect(playerName(4)).toBe('Purple');
    expect(nodeName(board, 'keep')).toBe('Keep');
    expect(nodeName(board, 's3')).toBe('start 3');
    expect(nodeName(board, 'a')).toBe('a');
  });

  it('describes events', () => {
    expect(describeEvent(board, { type: 'rolled', player: 1, value: 4 })).toBe('Blue rolls 4');
    expect(
      describeEvent(board, {
        type: 'fieldBattle',
        player: 0,
        target: 'b',
        contributions: [
          { from: 'a', count: 2 },
          { from: 'f', count: 1 },
        ],
        defender: 2,
        defeated: 2,
      }),
    ).toBe('Red attacks b (2 from a, 1 from f) and beats 2 knights of Yellow');
    expect(
      describeEvent(board, {
        type: 'castleAttacked',
        player: 0,
        castle: 'keep',
        from: 'c',
        attackers: 5,
        defender: 1,
        garrison: 1,
        shield: 3,
        won: false,
      }),
    ).toBe('Red attacks Keep (Blue, 1 knight, shield 3) with 5 from c: lost');
  });
});
