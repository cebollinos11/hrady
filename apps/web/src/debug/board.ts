import type { Board, BoardNode } from '@hrady/board';
import type { GameView } from '@hrady/engine';
import { PLAYER_COLOURS } from '../shared/describe';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Fallback drawing size when the board has no reference image. */
const DEFAULT_SIZE = { width: 876, height: 1200 };

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
};

export interface DrawOptions {
  labels: boolean;
  /** URL of the reference photo drawn under the graph (dev builds only). */
  underlay: string | null;
  underlayOpacity: number;
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

export const boardSize = (board: Board) => board.data.image ?? DEFAULT_SIZE;

function markClass(marks: Marks, id: string): string {
  const cls: string[] = [];
  if (marks.selectable.has(id)) cls.push('selectable');
  if (marks.selected === id) cls.push('selected');
  if (marks.moves.has(id)) cls.push('move-target');
  if (marks.castles.has(id)) cls.push('castle-target');
  if (marks.fields.has(id)) cls.push('field-target');
  if (marks.target === id) cls.push('attack-target');
  if (marks.sources.has(id)) cls.push(marks.sources.get(id) ? 'source on' : 'source');
  if (marks.shield === id) cls.push('shield-target');
  return cls.join(' ');
}

/** A knight stack: a disc in the player's colour with the count. */
function stack(x: number, y: number, r: number, player: number, count: number): SVGGElement {
  const g = el('g', { class: 'stack' });
  g.append(
    el('circle', { cx: x, cy: y, r, fill: PLAYER_COLOURS[player] ?? '#777' }),
    el('text', { x, y, 'font-size': r * 1.2 }, String(count)),
  );
  return g;
}

/** A shield badge: its value, or "?" while face down for this viewer. */
function shieldBadge(x: number, y: number, value: number | null, revealed: boolean): SVGGElement {
  const g = el('g', { class: `shield${revealed ? ' revealed' : ''}` });
  g.append(
    el('path', { d: `M${x - 8},${y - 9} h16 v7 q0,9 -8,13 q-8,-4 -8,-13 z` }),
    el('text', { x, y: y + 1 }, value === null ? '?' : String(value)),
  );
  return g;
}

function drawNode(n: BoardNode, view: GameView, px: number, py: number): SVGGElement {
  const g = el('g', {});
  const counts = view.knights[n.id] ?? [];
  if (n.type === 'path') {
    g.append(el('circle', { cx: px, cy: py, r: 13, class: 'base' }));
    counts.forEach((c, p) => c && g.append(stack(px, py, 11, p, c)));
  } else if (n.type === 'start') {
    g.append(
      el('rect', { x: px - 22, y: py - 16, width: 44, height: 32, rx: 5, class: 'base' }),
      el('text', { x: px, y: py - 8, class: 'start-number' }, String(n.number)),
    );
    const present = counts.flatMap((c, p) => (c ? [[p, c] as const] : []));
    present.forEach(([p, c], i) =>
      g.append(stack(px + (i - (present.length - 1) / 2) * 15, py + 7, 7, p, c)),
    );
  } else {
    const castle = view.castles[n.id];
    const owner = castle?.owner ?? null;
    g.append(
      el('path', {
        d: `M${px - 17},${py + 14} v-22 h7 v-6 h6 v6 h8 v-6 h6 v6 h7 v22 z`,
        class: 'base castle-shape',
        style: `fill: ${owner === null ? '#b7ab95' : (PLAYER_COLOURS[owner] ?? '#777')}`,
      }),
      el('text', { x: px, y: py + 25, class: 'swords' }, '⚔'.repeat(n.value)),
    );
    if (owner !== null)
      g.append(el('text', { x: px, y: py + 4, class: 'garrison' }, String(counts[owner] ?? 0)));
    if (castle?.shield)
      g.append(shieldBadge(px + 19, py - 12, castle.shield.value, castle.shield.revealed));
  }
  return g;
}

function nodeLabel(n: BoardNode): string {
  return n.type === 'castle' ? n.name : n.type === 'path' ? n.id : '';
}

/** Draws the board graph and the game on it into `svg`, replacing its contents. */
export function drawBoard(
  svg: SVGSVGElement,
  board: Board,
  view: GameView,
  marks: Marks,
  options: DrawOptions,
): void {
  const { width, height } = boardSize(board);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const pos = (n: BoardNode) => [n.x * width, n.y * height] as const;

  if (options.underlay)
    svg.append(
      el('image', { href: options.underlay, width, height, opacity: options.underlayOpacity }),
    );

  const edges = el('g', { class: 'edges' });
  for (const [a, b] of board.data.edges) {
    const na = board.nodes.get(a)!;
    const nb = board.nodes.get(b)!;
    const [x1, y1] = pos(na);
    const [x2, y2] = pos(nb);
    const access = na.type === 'castle' || nb.type === 'castle';
    edges.append(el('line', { x1, y1, x2, y2, class: access ? 'access' : '' }));
  }
  svg.append(edges);

  const nodes = el('g', { class: 'nodes' });
  for (const n of board.data.nodes) {
    const [px, py] = pos(n);
    const g = drawNode(n, view, px, py);
    g.setAttribute('class', `node ${n.type} ${markClass(marks, n.id)}`);
    g.dataset.id = n.id;
    const title = el('title', {}, n.type === 'castle' ? `${n.name} (${n.value})` : n.id);
    g.prepend(title);
    nodes.append(g);
    if (options.labels && nodeLabel(n))
      nodes.append(
        el(
          'text',
          { x: px, y: py - (n.type === 'castle' ? 22 : 17), class: 'label' },
          nodeLabel(n),
        ),
      );
  }
  svg.append(nodes);
}
