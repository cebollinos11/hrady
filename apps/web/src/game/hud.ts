import type { Board } from '@hrady/board';
import { score, type GameState, type GameView, type PlayerId } from '@hrady/engine';
import { PLAYER_COLOURS, nodeName, playerName } from '../shared/describe';
import { SEAT_NAMES, type Seat } from '../shared/seats';

/** Small DOM helpers and the parts of the HUD that only depend on game data. */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function swatch(player: PlayerId) {
  const s = h('span', { className: 'swatch' });
  s.style.background = PLAYER_COLOURS[player] ?? '#777';
  return s;
}

export function button(
  label: string,
  onClick: () => void,
  props: Partial<HTMLButtonElement> = {},
): HTMLButtonElement {
  return h('button', { type: 'button', ...props, onclick: onClick }, label);
}

/** A − [n] + counter. */
export function counter(
  value: number,
  min: number,
  max: number,
  onChange: (n: number) => void,
): HTMLElement {
  const input = h('input', {
    type: 'number',
    min: String(min),
    max: String(max),
    value: String(value),
  });
  input.onchange = () => onChange(Number(input.value));
  return h(
    'span',
    { className: 'counter' },
    button('−', () => onChange(value - 1), { disabled: value <= min, title: 'Fewer (↓)' }),
    input,
    button('+', () => onChange(value + 1), { disabled: value >= max, title: 'More (↑)' }),
  );
}

const SEAT_SHORT: Record<Seat, string> = {
  human: 'you',
  easy: 'easy bot',
  medium: 'medium bot',
  hard: 'hard bot',
};

/** Turn, phase and movement points of the shown state. */
export function statusView(view: GameView, seats: readonly Seat[]): Node[] {
  const p = view.current;
  const who = h('h2', {}, swatch(p), ` ${playerName(p)}`);
  if (view.phase === 'over') return [h('h2', {}, 'Game over'), h('p', {}, `Turn ${view.turn}`)];
  const seat = seats[p] ?? 'human';
  const phase = view.phase === 'roll' ? 'to roll' : `rolled ${view.roll} · ${view.mp} MP left`;
  const out: Node[] = [
    who,
    h('p', {}, `Turn ${view.turn} · ${seat === 'human' ? '' : `${SEAT_NAMES[seat]} · `}${phase}`),
  ];
  if (view.phase === 'move')
    out.push(
      h(
        'div',
        { className: 'pips', title: `${view.mp} movement points left` },
        ...Array.from({ length: view.config.rules.movePoints }, (_, i) =>
          h('span', { className: `pip${i < view.mp ? ' on' : ''}` }),
        ),
      ),
    );
  return out;
}

/** Shield chips: values for the viewer's own shields, a count for the others. */
function shieldCell(view: GameView, player: PlayerId): (Node | string)[] {
  if (view.viewer === player && view.ownShields)
    return view.ownShields.length
      ? [...view.ownShields]
          .sort()
          .map((v) => h('span', { className: 'chip', title: 'Your face-down shields' }, String(v)))
      : ['–'];
  return [String(view.shieldsLeft[player] ?? 0)];
}

/** Points, knights on the board and shields per player. */
export function playersTable(state: GameState, view: GameView, seats: readonly Seat[]): Node[] {
  const { points, knights, winners } = score(state);
  const over = state.phase === 'over';
  const head = h(
    'tr',
    {},
    h('th', {}, 'Player'),
    h('th', { title: 'Swords of the castles held' }, 'Points'),
    h('th', { title: 'Knights on the board (the supply is unlimited)' }, 'Knights'),
    h('th', { title: 'Shields left to place' }, 'Shields'),
  );
  const rows = points.map((pts, p) =>
    h(
      'tr',
      { className: p === view.current && !over ? 'current' : '' },
      h(
        'td',
        {},
        swatch(p),
        ` ${playerName(p)}${over && winners.includes(p) ? ' ★' : ''} `,
        h('span', { className: 'seat' }, SEAT_SHORT[seats[p] ?? 'human']),
      ),
      h('td', {}, String(pts)),
      h('td', {}, String(knights[p] ?? 0)),
      h('td', {}, ...shieldCell(view, p)),
    ),
  );
  return [head, ...rows];
}

/** What the tooltip says about a node. */
export function describeNode(board: Board, view: GameView, id: string): string {
  const node = board.nodes.get(id);
  if (!node) return id;
  const counts = view.knights[id] ?? [];
  const stacks = counts.flatMap((c, p) => (c ? [`${playerName(p)} ${c}`] : []));
  const knights = stacks.length ? ` · ${stacks.join(', ')}` : '';
  if (node.type === 'castle') {
    const castle = view.castles[id];
    const owner = castle?.owner ?? null;
    const holder = owner === null ? 'neutral' : `held by ${playerName(owner)}`;
    const shield = castle?.shield
      ? ` · shield ${castle.shield.value ?? '?'}${castle.shield.revealed ? ' (face up)' : ''}`
      : '';
    return `${node.name} · ${node.value} sword${node.value === 1 ? '' : 's'} · ${holder}${knights}${shield}`;
  }
  if (node.type === 'start') return `Start area ${node.number}${knights}`;
  return `${nodeName(board, id)}${knights}`;
}
