import { describe, expect, it } from 'vitest';
import { FACE_VALUES, restingRotation, topFace } from '../src/game/dice';

describe('die', () => {
  it('has opposite faces adding up to 7', () => {
    for (let i = 0; i < 6; i += 2) expect(FACE_VALUES[i]! + FACE_VALUES[i + 1]!).toBe(7);
  });

  it('rests with the rolled value on top, whatever the yaw', () => {
    for (let value = 1; value <= 6; value++)
      for (const yaw of [0, 0.7, 2, -3]) expect(topFace(restingRotation(value, yaw))).toBe(value);
  });

  it('rejects values that are not on a die', () => {
    expect(() => restingRotation(7)).toThrow(RangeError);
  });
});
