import {
  boardContext,
  score,
  validateAction,
  viewFor,
  type Action,
  type GameState,
  type PlayerId,
} from '@hrady/engine';
import { Animator } from './game/animator';
import { DieView } from './game/dieView';
import { button, counter, describeNode, h, playersTable, statusView, swatch } from './game/hud';
import {
  ANIMATION_SPEED,
  BOT_DELAY,
  SETTINGS_KEY,
  loadGame,
  loadSettings,
  save,
  saveGame,
  type Settings,
} from './game/saved';
import { BoardScene } from './game/scene';
import { planSteps } from './game/steps';
import type { Preset } from './game/camera';
import { BotClient } from './shared/botClient';
import { describeEvent, nodeName, playerName } from './shared/describe';
import { NO_MARKS, marksFor } from './shared/marks';
import {
  SEAT_CHOICES,
  SEAT_NAMES,
  isBotTurn,
  observation,
  viewerFor,
  type Seat,
} from './shared/seats';
import {
  NONE,
  attackAction,
  click,
  optionsFor,
  setContribution,
  setCount,
  type Selection,
} from './shared/selection';
import { act, canUndo, newSession, undo, undoTurn, type Session } from './shared/session';

// The 2D debug client stays reachable: index.html?debug opens it.
if (new URLSearchParams(location.search).has('debug')) location.replace('debug.html');

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const settings: Settings = loadSettings(localStorage);
const saved = loadGame(localStorage);
let session: Session = saved?.session ?? newSession({ players: 3 }, randomSeed());
let seats: Seat[] = saved?.seats ?? ['human', 'medium', 'medium'];
let options = optionsFor(session.state);
let selection: Selection = NONE;
/** The state the board and HUD show: behind `session.state` while animations play. */
let shown: GameState = session.state;
/** Number of log entries behind `shown`. */
let shownLength = session.log.length;
/** Player the board is hidden from until they confirm they are at the screen. */
let curtain: PlayerId | null = null;
let gameOverSeen = session.state.phase === 'over';

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

const board = () => boardContext(session.state.config).board;
const scene = new BoardScene($<HTMLCanvasElement>('#scene'), board());
const die = new DieView($<HTMLCanvasElement>('#die'));
const animator = new Animator(scene, die);
animator.onIdle = () => render();
const bots = new BotClient();

const botTurn = () => isBotTurn(session.state, seats);
const viewer = () => viewerFor(session.state, seats);
/** Clicks and keys go to the game only on a human's turn with nothing in the way. */
const interactive = () =>
  !botTurn() && curtain === null && session.state.phase !== 'over' && $('#setup').hidden;

function persist() {
  saveGame(localStorage, { session, seats });
  save(localStorage, SETTINGS_KEY, settings);
}

// --- Game flow -------------------------------------------------------------

/** Shows a state on the board straight away (new game, undo, resume). */
function snap() {
  animator.clear();
  shown = session.state;
  shownLength = session.log.length;
  const view = viewFor(shown, viewer());
  scene.showKnights(view.knights);
  scene.showCastles(view.castles);
  if (view.roll !== null) die.show(view.roll);
  render();
}

/** Covers the board when it is about to show another human's side. */
function passScreen(before: PlayerId | null) {
  const now = viewer();
  if (
    now !== null &&
    now !== before &&
    settings.passScreen &&
    seats.filter((s) => s === 'human').length > 1
  )
    curtain = now;
}

function perform(action: Action) {
  let next: Session;
  try {
    next = act(session, action);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    return;
  }
  const before = viewer();
  const entry = next.log.at(-1)!;
  const prev = shown;
  session = next;
  options = optionsFor(session.state);
  selection = NONE;
  passScreen(before);
  persist();
  const after = session.state;
  const length = session.log.length;
  animator.enqueue({
    before: viewFor(prev, viewer()).knights,
    steps: planSteps(entry.events),
    done: () => {
      shown = after;
      shownLength = length;
      const view = viewFor(after, viewer());
      scene.showKnights(view.knights);
      scene.showCastles(view.castles);
      render();
    },
  });
  render();
}

function setSession(next: Session) {
  const before = viewer();
  session = next;
  options = optionsFor(session.state);
  selection = NONE;
  passScreen(before);
  persist();
  snap();
}

function select(next: Selection) {
  selection = next;
  render();
}

const isLegal = (action: Action) => validateAction(session.state, action) === null;

function onNodeClick(id: string) {
  if (animator.busy) {
    animator.hurry();
    return;
  }
  if (!interactive()) return;
  const result = click(selection, options, id, isLegal);
  if (result.action) perform(result.action);
  else select(result.selection);
}

function startGame(players: number, newSeats: Seat[], seed: number) {
  bots.cancel();
  seats = newSeats;
  curtain = null;
  gameOverSeen = false;
  $('#game-over').hidden = true;
  session = newSession({ players }, seed);
  options = optionsFor(session.state);
  selection = NONE;
  passScreen(null);
  persist();
  snap();
  scene.rig.go('overview');
}

// --- Bots ------------------------------------------------------------------

/** Number of actions in the game when the bot request went out. */
let botRequest: number | null = null;

/** Asks the bot to move when it is a bot's turn; its action waits for the animations and a delay. */
function scheduleBot() {
  if (!botTurn() || curtain !== null || botRequest !== null) return;
  const player = session.state.current;
  const length = session.record.actions.length;
  botRequest = length;
  const asked = performance.now();
  bots
    .request(
      player,
      seats[player] as Exclude<Seat, 'human'>,
      session.record.seed + player,
      observation(session, player),
    )
    .then(async (action) => {
      await animator.whenIdle();
      const wait = BOT_DELAY[settings.botSpeed] - (performance.now() - asked);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await animator.whenIdle();
      if (botRequest !== length) return;
      botRequest = null;
      const stale = session.record.actions.length !== length || !botTurn() || curtain !== null;
      if (action && !stale) perform(action);
      else render();
    })
    .catch((err: unknown) => {
      botRequest = null;
      toast(`Bot error: ${err instanceof Error ? err.message : String(err)}`);
    });
}

/** Forgets a bot request whose game has moved on (undo, new game, seat change). */
function dropBotRequest() {
  if (botRequest !== null && botRequest !== session.record.actions.length) {
    bots.cancel();
    botRequest = null;
  }
}

// --- Rendering -------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

const name = (id: string) => nodeName(board(), id);

function renderControls() {
  const controls = $('#controls');
  const { state } = session;
  if (state.phase === 'over' && shown.phase === 'over') {
    const { winners } = score(state);
    controls.replaceChildren(
      h('p', { className: 'offer' }, `${winners.map(playerName).join(' and ')} won.`),
      h('div', { className: 'row' }, button('New game', openSetup, { className: 'primary' })),
    );
    return;
  }
  if (botTurn() || animator.busy) {
    const p = state.current;
    const text = botTurn()
      ? curtain !== null
        ? 'waits for the screen to be shown.'
        : bots.thinking
          ? 'is thinking…'
          : 'is moving…'
      : 'is moving…';
    controls.replaceChildren(
      h(
        'p',
        { className: 'hint' },
        swatch(p),
        ` ${playerName(p)} (${SEAT_NAMES[seats[p] ?? 'human']}) ${text}`,
      ),
    );
    return;
  }
  const player = state.current;
  const main: Node[] = [];
  if (options.roll)
    main.push(
      button('Roll (R)', () => perform({ type: 'roll', player }), { className: 'primary' }),
    );
  if (options.endTurn)
    main.push(
      button('End turn (E)', () => perform({ type: 'endTurn', player }), {
        className: state.mp === 0 ? 'primary' : '',
      }),
    );
  const out: Node[] = [h('div', { className: 'row' }, ...main)];
  if (state.phase === 'move')
    out.push(
      h(
        'div',
        { className: 'row' },
        button('Undo (Z)', () => setSession(undo(session)), {
          disabled: !canUndo(session),
          title: 'Take back the last move',
        }),
        button('Undo turn', () => setSession(undoTurn(session)), {
          disabled: !canUndo(session),
          title: 'Take back every move since the roll, the last battle or shield',
        }),
      ),
    );
  if (options.shield) {
    const castle = options.shield;
    out.push(
      h(
        'p',
        { className: 'offer' },
        `${name(castle)} is yours. `,
        button('Place a shield (S)', () => perform({ type: 'placeShield', player, castle }), {
          className: 'primary',
        }),
        h(
          'span',
          { className: 'hint' },
          ' A random one of yours, face down. Any other action declines it.',
        ),
      ),
    );
  }
  controls.replaceChildren(...out);
}

function renderSelection() {
  const panel = $('#selection');
  if (!interactive() || animator.busy) {
    panel.replaceChildren();
    return;
  }
  const { state } = session;
  if (selection.kind === 'stack') {
    const { from, count } = selection;
    const max = options.movable.get(from) ?? 1;
    const set = (n: number) => select(setCount(selection, options, n));
    panel.replaceChildren(
      h('h3', {}, `Stack on ${name(from)}`),
      h(
        'div',
        { className: 'row' },
        'Send ',
        counter(count, 1, max, set),
        ` of ${max}`,
        button('1', () => set(1), { disabled: count === 1 }),
        button('All', () => set(max), { disabled: count === max }),
      ),
      h(
        'p',
        { className: 'hint' },
        'Click a green node to move, an orange castle to attack it (the count moves in on a win), or a red marker to attack it.',
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
      return h(
        'tr',
        {},
        h('td', {}, name(from)),
        h(
          'td',
          {},
          counter(n, 0, max, (v) => select(setContribution(sel, options, from, v))),
        ),
        h('td', {}, ` of ${max}`),
      );
    });
    const action = attackAction(sel, state.current);
    const total = Object.values(sel.contributions).reduce((a, b) => a + b, 0);
    const stacks = Object.values(sel.contributions).filter((n) => n > 0).length;
    const reason = action ? validateAction(state, action) : 'Choose at least one stack.';
    panel.replaceChildren(
      h('h3', {}, `Attack ${name(sel.target)}`),
      h(
        'p',
        { className: 'hint' },
        swatch(defender),
        ` ${defenders} defending · ${total} attacking from ${stacks} stack${stacks === 1 ? '' : 's'} (${stacks} MP)`,
      ),
      h('table', { className: 'sources' }, ...rows),
      h('p', { className: reason ? 'hint bad' : 'hint' }, reason ?? 'Ready.'),
      h(
        'div',
        { className: 'row' },
        button('Attack (Enter)', () => action && perform(action), {
          disabled: reason !== null,
          className: 'primary',
        }),
        button('Cancel (Esc)', () => select(NONE)),
      ),
      h(
        'p',
        { className: 'hint' },
        'Click a blue-ringed neighbour to add or remove it; click the target to attack.',
      ),
    );
    return;
  }
  const hint =
    state.phase === 'roll'
      ? 'Roll the die to bring in a knight and get your 3 movement points.'
      : 'Click one of your stacks (white ring), or a red-ringed enemy marker to plan an attack.';
  panel.replaceChildren(h('p', { className: 'hint' }, hint));
}

let logShown = -1;
function renderLog() {
  // The log follows the board: actions still being animated are not listed yet.
  if (shownLength === logShown) return;
  logShown = shownLength;
  const items = session.log
    .slice(0, shownLength)
    .flatMap((entry) =>
      entry.events.map((e) =>
        h(
          'li',
          { className: e.type === 'rolled' ? 'turn-start' : e.type },
          describeEvent(board(), e),
        ),
      ),
    );
  const log = $('#log');
  log.replaceChildren(...items);
  log.scrollTop = log.scrollHeight;
}

function render() {
  const view = viewFor(shown, viewer());
  $('#status').replaceChildren(...statusView(view, seats));
  renderControls();
  renderSelection();
  $('#players').replaceChildren(...playersTable(shown, view, seats));
  renderLog();
  scene.showMarks(interactive() && !animator.busy ? marksFor(selection, options) : NO_MARKS);

  $('#curtain').hidden = curtain === null;
  if (curtain !== null)
    $('#curtain-text').textContent =
      `${playerName(curtain)} to play. Pass the screen to ${playerName(curtain)}.`;

  if (shown.phase === 'over' && !gameOverSeen && !animator.busy) {
    gameOverSeen = true;
    showGameOver();
  }
  dropBotRequest();
  scheduleBot();
}

function showGameOver() {
  const { winners } = score(session.state);
  $('#game-over-title').textContent =
    `${winners.map(playerName).join(' and ')} win${winners.length === 1 ? 's' : ''}!`;
  $('#game-over-scores').replaceChildren(
    ...playersTable(session.state, viewFor(session.state, null), seats),
  );
  $('#game-over').hidden = false;
}

// --- New game dialog -----------------------------------------------------------

let setupSeats: Seat[] = [];

function renderSetupSeats() {
  const players = Number($<HTMLSelectElement>('#setup-players').value);
  setupSeats = Array.from(
    { length: players },
    (_, p) => setupSeats[p] ?? (p === 0 ? 'human' : 'medium'),
  );
  $('#setup-seats').replaceChildren(
    ...setupSeats.map((seat, p) => {
      const select = h('select', { ariaLabel: `${playerName(p)} is played by` });
      for (const choice of SEAT_CHOICES)
        select.append(
          h('option', { value: choice, selected: choice === seat }, SEAT_NAMES[choice]),
        );
      select.onchange = () => (setupSeats[p] = select.value as Seat);
      return h('tr', {}, h('td', {}, swatch(p), ` ${playerName(p)}`), h('td', {}, select));
    }),
  );
}

function openSetup() {
  setupSeats = [...seats];
  $<HTMLSelectElement>('#setup-players').value = String(session.state.config.players);
  $<HTMLInputElement>('#setup-seed').value = '';
  renderSetupSeats();
  $('#game-over').hidden = true;
  $('#setup').hidden = false;
  render();
}

function closeSetup() {
  $('#setup').hidden = true;
  render();
}

$('#setup-players').addEventListener('change', renderSetupSeats);
$('#setup-cancel').addEventListener('click', closeSetup);
$<HTMLFormElement>('#setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const players = Number($<HTMLSelectElement>('#setup-players').value);
  const seedText = $<HTMLInputElement>('#setup-seed').value;
  const seed = seedText === '' ? randomSeed() : Math.trunc(Number(seedText));
  $('#setup').hidden = true;
  startGame(players, setupSeats.slice(0, players), seed);
});
$('#new-game').addEventListener('click', openSetup);
$('#game-over-new').addEventListener('click', openSetup);
$('#game-over-close').addEventListener('click', () => ($('#game-over').hidden = true));
$('#log-toggle').addEventListener('click', () => {
  const collapsed = $('#log-box').classList.toggle('collapsed');
  $('#log-toggle').setAttribute('aria-expanded', String(!collapsed));
  if (!collapsed) $('#log').scrollTop = $('#log').scrollHeight;
});
$('#reveal').addEventListener('click', () => {
  curtain = null;
  render();
});

// --- Settings ------------------------------------------------------------------

function applySettings() {
  animator.speed = ANIMATION_SPEED[settings.animations];
  scene.setLabels(settings.labels);
  $<HTMLSelectElement>('#bot-speed').value = settings.botSpeed;
  $<HTMLSelectElement>('#animations').value = settings.animations;
  $<HTMLInputElement>('#pass-screen').checked = settings.passScreen;
  $<HTMLInputElement>('#labels').checked = settings.labels;
}

function updateSettings(change: Partial<Settings>) {
  Object.assign(settings, change);
  if (!settings.passScreen) curtain = null;
  applySettings();
  persist();
  render();
}

$('#settings-button').addEventListener('click', () => {
  const pop = $('#settings');
  pop.hidden = !pop.hidden;
  $('#settings-button').setAttribute('aria-expanded', String(!pop.hidden));
});
$<HTMLSelectElement>('#bot-speed').addEventListener('change', (e) =>
  updateSettings({ botSpeed: (e.target as HTMLSelectElement).value as Settings['botSpeed'] }),
);
$<HTMLSelectElement>('#animations').addEventListener('change', (e) =>
  updateSettings({ animations: (e.target as HTMLSelectElement).value as Settings['animations'] }),
);
$<HTMLInputElement>('#pass-screen').addEventListener('change', (e) =>
  updateSettings({ passScreen: (e.target as HTMLInputElement).checked }),
);
$<HTMLInputElement>('#labels').addEventListener('change', (e) =>
  updateSettings({ labels: (e.target as HTMLInputElement).checked }),
);

// --- Camera ----------------------------------------------------------------------

/** The point the Zoom preset looks at: the selection, else the viewer's knights. */
function focusPoint() {
  const id =
    selection.kind === 'stack'
      ? selection.from
      : selection.kind === 'attack'
        ? selection.target
        : null;
  if (id) return scene.nodePoint(id);
  const p = viewer() ?? session.state.current;
  const nodes = Object.entries(shown.knights).filter(([, c]) => (c[p] ?? 0) > 0);
  if (!nodes.length) return { x: 0, z: 0 };
  const pts = nodes.map(([id]) => scene.nodePoint(id));
  return {
    x: pts.reduce((a, b) => a + b.x, 0) / pts.length,
    z: pts.reduce((a, b) => a + b.z, 0) / pts.length,
  };
}

function camera(preset: Preset) {
  scene.rig.go(preset, preset === 'focus' ? focusPoint() : null);
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-cam]'))
  b.addEventListener('click', () => camera(b.dataset.cam as Preset));

// --- Pointer and keys ----------------------------------------------------------------

const canvas = scene.canvas;
let down: { x: number; y: number; t: number; id: number } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  $('#settings').hidden = true;
});
canvas.addEventListener('pointerup', (e) => {
  const d = down;
  down = null;
  if (!d || d.id !== e.pointerId || e.button > 0) return;
  // A drag pans the camera; only a short, still press is a click.
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 700) return;
  const id = scene.pick(e.clientX, e.clientY);
  if (id) onNodeClick(id);
  else if (interactive() && selection.kind !== 'none') select(NONE);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const tooltip = $('#tooltip');
let hovered: string | null = null;
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons) {
    tooltip.hidden = true;
    return;
  }
  hovered = scene.pick(e.clientX, e.clientY);
  canvas.style.cursor = hovered && interactive() ? 'pointer' : '';
  if (!hovered) {
    tooltip.hidden = true;
    return;
  }
  tooltip.textContent = describeNode(board(), viewFor(shown, viewer()), hovered);
  tooltip.style.left = `${e.clientX}px`;
  tooltip.style.top = `${e.clientY}px`;
  tooltip.hidden = false;
});
canvas.addEventListener('pointerleave', () => (tooltip.hidden = true));

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') {
    if (e.key === 'Enter') target.dispatchEvent(new Event('change'));
    return;
  }
  if (target.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('#setup').hidden) return;
  const cams: Record<string, Preset> = { '1': 'overview', '2': 'table', '3': 'focus' };
  if (e.key in cams) {
    camera(cams[e.key]!);
    return;
  }
  if (e.key === 'l') {
    updateSettings({ labels: !settings.labels });
    return;
  }
  if (animator.busy) {
    if (e.key === ' ' || e.key === 'Escape') animator.hurry();
    return;
  }
  if (!interactive()) return;
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

// --- Layout and frame loop ---------------------------------------------------------

/** Sizes the 3D view to the part of the window the panel leaves free. */
function layout() {
  const panel = $('#panel').getBoundingClientRect();
  const bottomSheet = panel.left < 20;
  const width = bottomSheet ? window.innerWidth : panel.left - 10;
  const height = bottomSheet ? panel.top + 12 : window.innerHeight;
  canvas.style.width = `${Math.max(1, width)}px`;
  canvas.style.height = `${Math.max(1, height)}px`;
  scene.resize();
}

new ResizeObserver(layout).observe($('#panel'));
window.addEventListener('resize', layout);

scene.renderer.setAnimationLoop((now) => {
  scene.render(now);
  die.update(now);
});

applySettings();
if (window.matchMedia('(max-width: 760px)').matches) $('#log-box').classList.add('collapsed');
layout();
scene.rig.go('overview', null, true);
if (
  settings.passScreen &&
  session.record.actions.length &&
  seats.filter((s) => s === 'human').length > 1
)
  curtain = viewer();
snap();
if (!saved) openSetup();

// Lets browser tests find nodes on screen and read the game (dev server only).
if (import.meta.env.DEV)
  Object.assign(window, {
    hrady: {
      screenPoint: (id: string) => scene.screenPoint(id),
      session: () => session,
      busy: () => animator.busy,
      look: (id: string) => scene.rig.go('focus', scene.nodePoint(id), true),
      moves: () => [...options.moves].map(([from, to]) => [from, [...to]]),
    },
  });
