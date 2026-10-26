import { parseBoard } from '@hrady/board';
import { describe, expect, it } from 'vitest';
import { testBoardData } from '../../../packages/engine/test/fixtures';
import {
  describeEvent,
  eventNodes,
  logLines,
  nodeName,
  placeName,
  playerName,
} from '../src/shared/describe';

const board = parseBoard(testBoardData());

describe('describe', () => {
  it('names players and nodes', () => {
    expect(playerName(0)).toBe('Red');
    expect(playerName(4)).toBe('Purple');
    expect(nodeName(board, 'keep')).toBe('Keep');
    expect(nodeName(board, 's3')).toBe('start 3');
    expect(nodeName(board, 'a')).toBe('a');
  });

  it('names path markers after their castle', () => {
    // d is the only entrance of the tower; the keep has two, c and g.
    expect(placeName(board, 'd')).toBe('gate of Tower');
    expect(placeName(board, 'c')).toMatch(/^gate of Keep, .+ side$/);
    expect(placeName(board, 'c')).not.toBe(placeName(board, 'g'));
    expect(placeName(board, 'a')).toMatch(/^road by /);
    expect(placeName(board, 'keep')).toBe('Keep');
    expect(placeName(board, 's3')).toBe('start 3');
    expect(
      describeEvent(board, { type: 'moved', player: 0, from: 's3', to: 'd', count: 2 }, placeName),
    ).toBe('Red moves 2 knights start 3 → gate of Tower');
  });

  it('merges a walk into one log line', () => {
    const lines = logLines(board, [
      { type: 'moved', player: 0, from: 'a', to: 'b', count: 2 },
      { type: 'moved', player: 0, from: 'b', to: 'c', count: 2 },
      { type: 'moved', player: 0, from: 'c', to: 'd', count: 1 },
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      'Red moves 2 knights a → b → c',
      'Red moves 1 knight c → d',
    ]);
    expect(lines[0]!.nodes).toEqual(['a', 'b', 'c']);
    // Stops that share a name are said once.
    expect(
      logLines(
        board,
        [
          { type: 'moved', player: 1, from: 'a', to: 'b', count: 1 },
          { type: 'moved', player: 1, from: 'b', to: 'c', count: 1 },
        ],
        () => 'road by Tower',
      )[0]!.text,
    ).toBe('Blue moves 1 knight along the road by Tower');
  });

  it('lists the nodes of an event', () => {
    expect(eventNodes({ type: 'moved', player: 0, from: 'a', to: 'b', count: 1 })).toEqual([
      'a',
      'b',
    ]);
    expect(eventNodes({ type: 'rolled', player: 0, value: 2 })).toEqual([]);
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
