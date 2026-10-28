import { describe, expect, it } from 'vitest';
import { scenario } from '../../../packages/engine/test/fixtures';
import { NO_MARKS, marksFor } from '../src/shared/marks';
import { NONE, click, optionsFor } from '../src/shared/selection';

describe('marksFor', () => {
  const state = scenario({ knights: { a: { 0: 3 }, f: { 0: 1 }, b: { 1: 2 } } });
  const options = optionsFor(state);

  it('marks every stack that can act, and no enemy markers until one is selected', () => {
    const marks = marksFor(NONE, options);
    expect([...marks.selectable].sort()).toEqual(['a', 'f']);
    expect(marks.fields.size).toBe(0);
    expect(marks.selected).toBeNull();
  });

  it('marks the targets of the selected stack', () => {
    const { selection } = click(NONE, options, 'a');
    const marks = marksFor(selection, options);
    expect(marks.selected).toBe('a');
    expect([...marks.moves].sort()).toEqual(['e', 'f', 'g']);
    expect(marks.costs.get('e')).toBe(1);
    expect(marks.costs.get('g')).toBe(3);
    expect([...marks.fields]).toEqual(['b']);
  });

  it('marks the sources of an attack being built', () => {
    const { selection } = click(NONE, options, 'b');
    const marks = marksFor(selection, options);
    expect(marks.target).toBe('b');
    expect([...marks.sources.keys()].sort()).toEqual(['a', 'f']);
    expect(marks.fields.size).toBe(0);
  });

  it('has nothing to show by default', () => {
    expect(NO_MARKS.selectable.size + NO_MARKS.moves.size).toBe(0);
  });
});
