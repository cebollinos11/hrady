import {
  boardContext,
  score,
  validateAction,
  viewFor,
  type Action,
  type GameState,
  type GameView,
  type PlayerId,
} from '@hrady/engine';
import type { BotRequest, BotResponse } from '../shared/bot.worker';
import { NO_MARKS, drawBoard, type Marks } from './board';
import { PLAYER_COLOURS, describeEvent, nodeName, playerName } from '../shared/describe';
import {
  NONE,
  attackAction,
  click,
  optionsFor,
  setContribution,
  setCount,
  targetsFor,
  type Options,
  type Selection,
} from '../shared/selection';
import {
  SEAT_CHOICES,
  SEAT_NAMES,
  isBotTurn,
  observation,
  seatsFor,
  viewerFor,
  type Seat,
} from '../shared/seats';
import {
  act,
  canUndo,
  exportRecord,
  frames,
  importRecord,
  newSession,
  truncate,
  undo,
  undoTurn,
  type Session,
} from '../shared/session';

const STORAGE_KEY = 'hrady-debug-game';
const SEATS_KEY = 'hrady-debug-seats';

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const svg = $<SVGSVGElement>('#board');

interface Replay {
  states: GameState[];
  /** Number of actions applied in the shown state. */
  index: number;
  viewer: PlayerId | null;
}

let session = loadSaved() ?? newSession({ players: 3 }, randomSeed());
let seats = seatsFor(session.state.config.players, loadJson(SEATS_KEY));
let options = optionsFor(session.state);
let selection: Selection = NONE;
let replay: Replay | null = null;
/** Player the board is hidden from until they confirm they are at the screen. */
let curtain: PlayerId | null = null;
let message = '';
let underlay: string | null = null;

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

function loadJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function loadSaved(): Session | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? importRecord(saved) : null;
  } catch {
    // Storage unavailable or the saved game no longer replays: start fresh.
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session.record));
    localStorage.setItem(SEATS_KEY, JSON.stringify(seats));
  } catch {
    // Keeping the game across reloads is a convenience only.
  }
}

const board = () => boardContext(session.state.config).board;
const name = (id: string) => nodeName(board(), id);
const curtainEnabled = () => $<HTMLInputElement>('#curtain-toggle').checked;

const botTurn = () => isBotTurn(session.state, seats);

function setSession(next: Session) {
  const before = viewerFor(session.state, seats);
  session = next;
  options = optionsFor(session.state);
  selection = NONE;
  message = '';
  passScreen(before);
  save();
  render();
}

/** Covers the board when it is about to show another human's side. */
function passScreen(before: PlayerId | null) {
  const viewer = viewerFor(session.state, seats);
  if (viewer !== null && viewer !== before && curtainEnabled()) curtain = viewer;
}

function perform(action: Action) {
  try {
    setSession(act(session, action));
  } catch (e) {
    showMessage(e instanceof Error ? e.message : String(e));
  }
}

function showMessage(text: string) {
  message = text;
  render();
}

function select(next: Selection) {
  selection = next;
  message = '';
  render();
}

const isLegal = (action: Action) => validateAction(session.state, action) === null;

function onNodeClick(id: string) {
  if (replay || curtain !== null || botTurn()) return;
  const result = click(selection, options, id, isLegal);
  if (result.action) perform(result.action);
  else select(result.selection);
}

// --- Rendering -------------------------------------------------------------

function marksFor(sel: Selection, opts: Options): Marks {
  const marks: Marks = {
    ...NO_MARKS,
    selectable: new Set(opts.movable.keys()),
    fields: new Set(opts.fields.keys()),
    shield: opts.shield,
  };
  if (sel.kind === 'stack') {
    const targets = targetsFor(opts, sel.from);
    return { ...marks, selected: sel.from, ...targets };
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

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function swatch(player: PlayerId) {
  const s = h('span', { className: 'swatch' });
  s.style.background = PLAYER_COLOURS[player] ?? '#777';
  return s;
}

function button(label: string, onClick: () => void, props: Partial<HTMLButtonElement> = {}) {
  return h('button', { ...props, onclick: onClick }, label);
}

function renderStatus(view: GameView) {
  const status = $('#status');
  const who = h('span', {}, swatch(view.current), ` ${playerName(view.current)}`);
  const phase =
    view.phase === 'roll'
      ? 'to roll'
      : view.phase === 'move'
        ? `rolled ${view.roll}, ${view.mp} MP left`
        : 'game over';
  status.replaceChildren(
    h('h2', {}, `Turn ${view.turn}`),
    h('p', { className: 'turn' }, who, ` — ${phase}`),
  );
  if (view.phase === 'move')
    status.append(
      h(
        'p',
        { className: 'pips' },
        h('span', { className: 'die' }, String(view.roll)),
        ...Array.from({ length: view.config.rules.movePoints }, (_, i) =>
          h('span', { className: `pip${i < view.mp ? ' on' : ''}` }),
        ),
      ),
    );
}

function renderControls() {
  const controls = $('#controls');
  if (replay) {
    controls.replaceChildren(...replayControls(replay));
    return;
  }
  const { state } = session;
  if (botTurn()) {
    controls.replaceChildren(...botControls());
    return;
  }
  const items: Node[] = [];
  if (options.roll)
    items.push(button('Roll (R)', () => perform({ type: 'roll', player: state.current })));
  if (options.endTurn)
    items.push(button('End turn (E)', () => perform({ type: 'endTurn', player: state.current })));
  if (state.phase === 'move') {
    items.push(
      button('Undo (Z)', () => setSession(undo(session)), {
        disabled: !canUndo(session),
        title: 'Take back the last move',
      }),
      button('Undo turn', () => setSession(undoTurn(session)), {
        disabled: !canUndo(session),
        title: 'Take back every move since the last roll, battle or shield',
      }),
    );
  }
  const row = h('div', { className: 'row' }, ...items);
  const out: Node[] = [row];
  if (options.shield) {
    const castle = options.shield;
    out.push(
      h(
        'p',
        { className: 'offer' },
        `${name(castle)} is yours. `,
        button('Place shield (S)', () =>
          perform({ type: 'placeShield', player: state.current, castle }),
        ),
        h('span', { className: 'hint' }, ' Any other action declines it.'),
      ),
    );
  }
  if (state.phase === 'over') {
    const { winners } = score(state);
    out.push(
      h('p', { className: 'offer' }, `${winners.map(playerName).join(' and ')} won.`),
      button('Step through the game', enterReplay),
    );
  }
  controls.replaceChildren(...out);
}

function botControls(): Node[] {
  const player = session.state.current;
  const step = botSpeed() === null;
  const status = pending
    ? 'is thinking…'
    : step
      ? 'is waiting for Step.'
      : curtain !== null
        ? 'waits for the screen to be shown.'
        : 'is about to move.';
  return [
    h(
      'p',
      { className: 'offer' },
      swatch(player),
      ` ${playerName(player)} (${SEAT_NAMES[seats[player]!]}) ${status}`,
    ),
    h(
      'div',
      { className: 'row' },
      button('Step (N)', requestBotMove, {
        disabled: !step || pending !== null,
        title: 'Let the bot make its next move',
      }),
    ),
  ];
}

function replayControls(r: Replay): Node[] {
  const last = r.states.length - 1;
  const go = (index: number) => {
    r.index = Math.max(0, Math.min(last, index));
    render();
  };
  const range = h('input', { type: 'range', min: '0', max: String(last), value: String(r.index) });
  range.oninput = () => go(Number(range.value));
  const viewer = h('select', {});
  viewer.append(h('option', { value: '' }, 'Spectator'));
  for (let p = 0; p < session.state.config.players; p++)
    viewer.append(h('option', { value: String(p), selected: r.viewer === p }, playerName(p)));
  viewer.onchange = () => {
    r.viewer = viewer.value === '' ? null : Number(viewer.value);
    render();
  };
  const action = session.log[r.index - 1];
  const lastLine = action
    ? action.events.map((e) => describeEvent(board(), e)).join('; ')
    : 'Initial state';
  return [
    h('h2', {}, `Replay — step ${r.index} / ${last}`),
    h(
      'div',
      { className: 'row' },
      button('⏮', () => go(0), { title: 'Start (Home)' }),
      button('◀', () => go(r.index - 1), { title: 'Back (←)' }),
      button('▶', () => go(r.index + 1), { title: 'Forward (→)' }),
      button('⏭', () => go(last), { title: 'End (End)' }),
      h('label', {}, 'View as ', viewer),
    ),
    range,
    h('p', { className: 'hint' }, lastLine),
    h(
      'div',
      { className: 'row' },
      button('Continue from here', () => {
        const dropped = last - r.index;
        if (dropped && !confirm(`Discard the ${dropped} later actions and play on from here?`))
          return;
        replay = null;
        setSession(truncate(session, r.index));
      }),
      button('Back to game', exitReplay),
    ),
  ];
}

function renderSelection() {
  const panel = $('#selection');
  if (replay) {
    panel.replaceChildren();
    return;
  }
  const { state } = session;
  if (selection.kind === 'stack') {
    const { from, count } = selection;
    const max = options.movable.get(from) ?? 1;
    const input = h('input', {
      type: 'number',
      min: '1',
      max: String(max),
      value: String(count),
      id: 'count',
    });
    input.onchange = () => select(setCount(selection, options, Number(input.value)));
    panel.replaceChildren(
      h('h2', {}, `Stack on ${name(from)}`),
      h(
        'p',
        { className: 'row' },
        'Send ',
        button('−', () => select(setCount(selection, options, count - 1))),
        input,
        button('+', () => select(setCount(selection, options, count + 1))),
        ` of ${max}`,
      ),
      h(
        'p',
        { className: 'hint' },
        'Click a green node to move, an orange castle to attack it (the count moves in), or a red marker to attack it. Esc cancels.',
      ),
    );
    return;
  }
  if (selection.kind === 'attack') {
    const sel = selection;
    const defender = state.knights[sel.target]?.findIndex((n) => n > 0) ?? -1;
    const defenders = state.knights[sel.target]?.[defender] ?? 0;
    const rows = Object.entries(sel.contributions).map(([from, n]) => {
      const max = options.fields.get(sel.target)?.get(from) ?? 0;
      const input = h('input', { type: 'number', min: '0', max: String(max), value: String(n) });
      input.dataset.from = from;
      input.onchange = () => select(setContribution(sel, options, from, Number(input.value)));
      return h('tr', {}, h('td', {}, name(from)), h('td', {}, input), h('td', {}, `of ${max}`));
    });
    const action = attackAction(sel, state.current);
    const total = Object.values(sel.contributions).reduce((a, b) => a + b, 0);
    const stacks = Object.values(sel.contributions).filter((n) => n > 0).length;
    const reason = action ? validateAction(state, action) : 'choose at least one stack';
    panel.replaceChildren(
      h('h2', {}, `Attack ${name(sel.target)}`),
      h(
        'p',
        {},
        swatch(defender),
        ` ${defenders} defending — ${total} attacking from ${stacks} stack${stacks === 1 ? '' : 's'} (${stacks} MP)`,
      ),
      h('table', { className: 'sources' }, ...rows),
      h('p', { className: reason ? 'hint bad' : 'hint' }, reason ?? 'Ready.'),
      h(
        'div',
        { className: 'row' },
        button('Attack (Enter)', () => action && perform(action), { disabled: reason !== null }),
        button('Cancel (Esc)', () => select(NONE)),
      ),
      h(
        'p',
        { className: 'hint' },
        'Click a highlighted neighbour to add or remove it; click the target to attack.',
      ),
    );
    return;
  }
  const hint = botTurn()
    ? ''
    : state.phase === 'roll'
      ? 'Roll the die to place a knight and get your movement points.'
      : state.phase === 'over'
        ? ''
        : 'Click one of your stacks (white ring) to select it, or a red-ringed enemy marker to plan an attack.';
  panel.replaceChildren(hint ? h('p', { className: 'hint' }, hint) : '');
}

function renderScores(state: GameState, view: GameView) {
  const { points, knights, winners } = score(state);
  const over = state.phase === 'over';
  const rows = points.map((p, player) => {
    const own = view.viewer === player && view.ownShields;
    const shields = own ? `[${own.join(' ')}]` : String(view.shieldsLeft[player]);
    const tr = h(
      'tr',
      { className: player === view.current && !over ? 'current' : '' },
      h(
        'td',
        {},
        swatch(player),
        ` ${playerName(player)}${over && winners.includes(player) ? ' ★' : ''}`,
      ),
      h('td', {}, String(p)),
      h('td', {}, String(knights[player])),
      h('td', {}, shields),
    );
    return tr;
  });
  $('#scores').replaceChildren(
    h(
      'tr',
      {},
      h('th', {}, ''),
      h('th', {}, 'Points'),
      h('th', {}, 'Knights'),
      h('th', {}, 'Shields'),
    ),
    ...rows,
  );
}

let logLength = -1;
let logStep = -1;

function renderLog() {
  const log = $<HTMLOListElement>('#log');
  const step = replay ? replay.index : session.log.length;
  if (logLength === session.log.length && logStep === step) return;
  const items = session.log.flatMap((entry, i) =>
    entry.events.map((e) => {
      const li = h('li', { className: e.type }, describeEvent(board(), e));
      li.dataset.step = String(i + 1);
      if (i >= step) li.classList.add('future');
      return li;
    }),
  );
  log.replaceChildren(...items);
  const current = replay ? log.querySelector(`[data-step="${step}"]`) : log.lastElementChild;
  current?.scrollIntoView({ block: 'nearest' });
  logLength = session.log.length;
  logStep = step;
}

function render() {
  const state = replay ? replay.states[replay.index]! : session.state;
  const viewer = replay ? replay.viewer : viewerFor(state, seats);
  const view = viewFor(state, viewer);
  const marks = replay || botTurn() ? NO_MARKS : marksFor(selection, options);
  drawBoard(svg, board(), view, marks, {
    labels: $<HTMLInputElement>('#labels').checked,
    underlay: $<HTMLInputElement>('#underlay').checked ? underlay : null,
    underlayOpacity: Number($<HTMLInputElement>('#underlay-opacity').value),
  });
  renderStatus(view);
  renderControls();
  renderSelection();
  renderScores(state, view);
  renderLog();
  document.body.classList.toggle('replaying', replay !== null);

  const msg = $<HTMLElement>('#message');
  msg.hidden = !message;
  msg.textContent = message;

  $<HTMLElement>('#curtain').hidden = curtain === null;
  if (curtain !== null)
    $('#curtain-text').textContent =
      `${playerName(curtain)} to play. Pass the screen to ${playerName(curtain)}.`;
  scheduleBot();
}

// --- Bots ------------------------------------------------------------------

let worker: Worker | null = null;
/** The bot request being worked on, and how long the game was when it was sent. */
let pending: { id: number; actions: number } | null = null;
let nextRequest = 1;
let botTimer: ReturnType<typeof setTimeout> | null = null;

/** Delay before a bot moves in milliseconds, or `null` to wait for Step. */
function botSpeed(): number | null {
  const value = $<HTMLSelectElement>('#bot-speed').value;
  return value === 'step' ? null : Number(value);
}

/** Starts a bot move after the chosen delay when a bot is to move and nothing is in the way. */
function scheduleBot() {
  const delay = botSpeed();
  if (replay || curtain !== null || !botTurn() || pending || delay === null) {
    if (botTimer !== null) clearTimeout(botTimer);
    botTimer = null;
    return;
  }
  botTimer ??= setTimeout(() => {
    botTimer = null;
    requestBotMove();
  }, delay);
}

function startWorker(): Worker {
  const w = new Worker(new URL('../shared/bot.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<BotResponse>) => onBotResponse(e.data);
  w.onerror = (e) => {
    pending = null;
    stopBots(`Bot worker failed: ${e.message}`);
  };
  return w;
}

/** Asks the bot to move now. Bots run in a worker so the page stays responsive. */
function requestBotMove() {
  if (replay || curtain !== null || !botTurn() || pending) return;
  const player = session.state.current;
  worker ??= startWorker();
  pending = { id: nextRequest++, actions: session.record.actions.length };
  const request: BotRequest = {
    id: pending.id,
    player,
    level: seats[player] as Exclude<Seat, 'human'>,
    seed: session.record.seed + player,
    obs: observation(session, player),
  };
  worker.postMessage(request);
  render();
}

function onBotResponse(response: BotResponse) {
  if (!pending || response.id !== pending.id) return;
  // The game moved on (undo, import, seat change) while the bot was thinking.
  const stale = pending.actions !== session.record.actions.length || !botTurn();
  pending = null;
  if ('error' in response) stopBots(`Bot error: ${response.error}`);
  else if (stale) render();
  else perform(response.action);
}

/** Switches bots to stepping after a failure, so it is not retried in a loop. */
function stopBots(text: string) {
  $<HTMLSelectElement>('#bot-speed').value = 'step';
  showMessage(text);
}

function renderSeats() {
  const rows = seats.map((seat, player) => {
    const select = h('select', {});
    for (const choice of SEAT_CHOICES)
      select.append(h('option', { value: choice, selected: choice === seat }, SEAT_NAMES[choice]));
    select.onchange = () => {
      const before = viewerFor(session.state, seats);
      seats[player] = select.value as Seat;
      selection = NONE;
      passScreen(before);
      save();
      render();
    };
    return h('tr', {}, h('td', {}, swatch(player), ` ${playerName(player)}`), h('td', {}, select));
  });
  $('#seats').replaceChildren(...rows);
}

/** Keeps the seat choices for a game with `players` seats. */
function resetSeats(players: number) {
  seats = seatsFor(players, seats);
  renderSeats();
}

// --- Replay, import and export --------------------------------------------

function enterReplay() {
  const states = frames(session.record);
  replay = { states, index: states.length - 1, viewer: null };
  selection = NONE;
  curtain = null;
  render();
}

function exitReplay() {
  replay = null;
  render();
}

function download() {
  const blob = new Blob([exportRecord(session)], { type: 'application/json' });
  const a = h('a', {
    href: URL.createObjectURL(blob),
    download: `hrady-${session.record.seed}-${session.record.actions.length}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

$<HTMLInputElement>('#import').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const next = importRecord(await file.text());
    replay = null;
    curtain = null;
    resetSeats(next.state.config.players);
    setSession(next);
  } catch (err) {
    showMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

$('#export').addEventListener('click', download);
$('#replay').addEventListener('click', () => (replay ? exitReplay() : enterReplay()));
$('#new').addEventListener('click', () => {
  if (session.record.actions.length && !confirm('Abandon the current game?')) return;
  const players = Number($<HTMLSelectElement>('#players').value);
  const seedText = $<HTMLInputElement>('#seed').value;
  const seed = seedText === '' ? randomSeed() : Math.trunc(Number(seedText));
  replay = null;
  curtain = null;
  resetSeats(players);
  setSession(newSession({ players }, seed));
});
$('#reveal').addEventListener('click', () => {
  curtain = null;
  render();
});
$('#bot-speed').addEventListener('change', render);
for (const id of ['#labels', '#underlay', '#underlay-opacity'])
  $(id).addEventListener('input', render);
$('#curtain-toggle').addEventListener('change', () => {
  if (!curtainEnabled()) curtain = null;
  render();
});

$('#log').addEventListener('click', (e) => {
  const step = (e.target as HTMLElement).closest<HTMLElement>('li')?.dataset.step;
  if (!replay || step === undefined) return;
  replay.index = Number(step);
  render();
});

svg.addEventListener('click', (e) => {
  const node = (e.target as Element).closest<SVGGElement>('.node');
  if (node?.dataset.id) onNodeClick(node.dataset.id);
  else if (!replay) select(NONE);
});

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') {
    if (e.key === 'Enter') target.dispatchEvent(new Event('change'));
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (replay) {
    const step: Record<string, number> = {
      ArrowLeft: replay.index - 1,
      ArrowRight: replay.index + 1,
      Home: 0,
      End: replay.states.length - 1,
    };
    if (e.key in step) {
      replay.index = Math.max(0, Math.min(replay.states.length - 1, step[e.key]!));
      render();
    } else if (e.key === 'Escape') exitReplay();
    return;
  }
  if (curtain !== null) return;
  if (botTurn()) {
    if (e.key === 'n') requestBotMove();
    return;
  }
  const player = session.state.current;
  switch (e.key) {
    case 'Escape':
      select(NONE);
      break;
    case 'r':
      if (options.roll) perform({ type: 'roll', player });
      break;
    case 'e':
      if (options.endTurn) perform({ type: 'endTurn', player });
      break;
    case 's':
      if (options.shield) perform({ type: 'placeShield', player, castle: options.shield });
      break;
    case 'z':
      setSession(undo(session));
      break;
    case '+':
    case '=':
    case 'ArrowUp':
      if (selection.kind === 'stack') select(setCount(selection, options, selection.count + 1));
      break;
    case '-':
    case 'ArrowDown':
      if (selection.kind === 'stack') select(setCount(selection, options, selection.count - 1));
      break;
    case 'Enter': {
      const action = attackAction(selection, player);
      if (action && isLegal(action)) perform(action);
      break;
    }
    default:
      return;
  }
  e.preventDefault();
});

// The board photo is a tracing aid only: it is loaded in dev builds and never
// bundled into production (the whole branch is dropped at build time).
if (import.meta.env.DEV) {
  $<HTMLElement>('#underlay-controls').hidden = false;
  void import('../../../../docs/board/board-full.jpg').then((m: { default: string }) => {
    underlay = m.default;
    render();
  });
}

$<HTMLSelectElement>('#players').value = String(session.state.config.players);
if (curtainEnabled() && session.record.actions.length) curtain = viewerFor(session.state, seats);
renderSeats();
render();
