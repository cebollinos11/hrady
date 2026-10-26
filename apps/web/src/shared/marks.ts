import { targetsFor, type Options, type Selection } from './selection';

/** How each node is highlighted for the current selection. */
export interface Marks {
  /** Own stacks that can do something. */
  selectable: ReadonlySet<string>;
  selected: string | null;
  moves: ReadonlySet<string>;
  castles: ReadonlySet<string>;
  fields: ReadonlySet<string>;
  /** Field attack being built: its target and every possible source with its count. */
  target: string | null;
  sources: ReadonlyMap<string, number>;
  /** Castle that may get a shield now. */
  shield: string | null;
  /** Movement points it takes the selected stack to reach each target. */
  costs: ReadonlyMap<string, number>;
}

export const NO_MARKS: Marks = {
  selectable: new Set(),
  selected: null,
  moves: new Set(),
  castles: new Set(),
  fields: new Set(),
  target: null,
  sources: new Map(),
  shield: null,
  costs: new Map(),
};

/** Highlights for the current selection, from the legal options. */
export function marksFor(sel: Selection, opts: Options): Marks {
  const marks: Marks = {
    ...NO_MARKS,
    selectable: new Set(opts.movable.keys()),
    fields: new Set(opts.fields.keys()),
    shield: opts.shield,
  };
  if (sel.kind === 'stack') {
    const { moves, castles, fields, paths } = targetsFor(opts, sel.from, sel.count);
    const costs = new Map([...paths].map(([id, path]) => [id, path.length]));
    return { ...marks, selected: sel.from, moves, castles, fields, costs };
  }
  if (sel.kind === 'attack')
    return {
      ...marks,
      fields: new Set(),
      target: sel.target,
      sources: new Map(Object.entries(sel.contributions)),
    };
  return marks;
}
