import {
  boardContext,
  legalActions,
  score,
  validateAction,
  viewFor,
  type Action,
  type GameState,
  type GameView,
  type PlayerId,
} from '@hrady/engine';
import { Animator } from './game/animator';
import { DieView } from './game/dieView';
import {
  button,
  counter,
  describeNode,
  h,
  localLabels,
  playersTable,
  statusView,
  swatch,
} from './game/hud';
import {
  normaliseCode,
  type Duty,
  type LogEntry,
  type RoomInfo,
  type ServerMessage,
} from '@hrady/protocol';
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
import { sinceLastTurn, summary, trailsOf } from './game/recent';
import { planSteps } from './game/steps';
import type { Preset } from './game/camera';
import type { Point } from './game/layout';
import { BotClient } from './shared/botClient';
import { logLines, placeName, playerName } from './shared/describe';
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
  carryOver,
  click,
  optionsFor,
  setContribution,
  setCount,
  targetsFor,
  type Selection,
} from './shared/selection';
import { act, canUndo, newSession, truncate, undo, undoTurn, type Session } from './shared/session';
import { serverUrl, socketUrl } from './online/config';
import { Connection, createRoom, roomExists, type ConnectionStatus } from './online/connection';
import { renderLobby, type LobbyHandlers, type LobbyScreen } from './online/lobby';
import { fromSnapshot, mirror, onlineFloor, stateFromView } from './online/mirror';
import { clockText, onlineLabels, seatOf } from './online/room';
import { forgetToken, loadOnline, rememberToken, saveOnline } from './online/store';

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
/** The state after the last queued animation; the next one starts from it. */
let queued: GameState = session.state;
/** Number of log entries behind `shown`. */
let shownLength = session.log.length;
/** Player the board is hidden from until they confirm they are at the screen. */
let curtain: PlayerId | null = null;
let gameOverSeen = session.state.phase === 'over';
/** The last multi-step walk, taken back as a whole by Undo while it is the latest action. */
let lastWalk: { end: number; size: number } | null = null;

/**
 * An online room, while this tab is in one. The board then shows `session`
 * as a mirror of the server's game (`online/mirror.ts`): the server applies
 * every action and sends this seat's view and the events back.
 */
interface Online {
  code: string;
  conn: Connection;
  /** This tab's member id, once welcomed. */
  me: string | null;
  room: RoomInfo | null;
  /** The server's log, with the `auto` flags undo needs. */
  log: LogEntry[];
  /** A game snapshot has arrived (the lobby is over). */
  inGame: boolean;
  /** Actions or undos sent and not answered yet. */
  pending: number;
  /** Selection to restore once the pending actions are back (a walk keeps its stack selected). */
  after: Selection | null;
  /** Bot seat this tab plays as AI host. */
  duty: Duty | null;
  /** `performance.now()` when a bot takes over the player to move. */
  deadline: number | null;
}

let online: Online | null = null;
const server = serverUrl(import.meta.env, location.hostname);
let onlineStore = loadOnline(localStorage);

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

const board = () => boardContext(session.state.config).board;
const scene = new BoardScene($<HTMLCanvasElement>('#scene'), board());
const die = new DieView($<HTMLCanvasElement>('#die'));
const animator = new Animator(scene, die);
animator.onIdle = () => render();
const bots = new BotClient();

/** This tab's seat online, `null` when watching. */
const mySeat = () => (online ? seatOf(online.room, online.me) : null);
/** A bot plays this tab's seat because its human was idle or away. */
function amAway() {
  const seat = mySeat();
  const info = seat === null ? undefined : online?.room?.seats[seat];
  return info?.type === 'human' && info.away;
}
/** Nobody at this screen is to move: a bot's turn locally, anyone else's online. */
function botTurn() {
  if (!online) return isBotTurn(session.state, seats);
  return !online.inGame || mySeat() !== session.state.current || amAway();
}
const viewer = () => (online ? mySeat() : viewerFor(session.state, seats));
/** Clicks and keys go to the game only on a human's turn with nothing in the way. */
const interactive = () =>
  !botTurn() &&
  curtain === null &&
  session.state.phase !== 'over' &&
  $('#setup').hidden &&
  $('#online').hidden &&
  !online?.pending;
const labels = () => (online?.room ? onlineLabels(online.room, online.me) : localLabels(seats));

function persist() {
  // The local game is kept while a tab plays online.
  if (!online) saveGame(localStorage, { session, seats });
  save(localStorage, SETTINGS_KEY, settings);
}

// --- Game flow -------------------------------------------------------------

/** Shows a state on the board straight away (new game, undo, resume). */
function snap() {
  animator.clear();
  shown = queued = session.state;
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
    !online &&
    now !== null &&
    now !== before &&
    settings.passScreen &&
    seats.filter((s) => s === 'human').length > 1
  )
    curtain = now;
}

function perform(action: Action): boolean {
  if (online) return sendAction(online, action);
  let next: Session;
  try {
    next = act(session, action);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    return false;
  }
  advance(next);
  return true;
}

/** Shows the session after one more action: animates its events, then settles the board. */
function advance(next: Session) {
  const before = viewer();
  const entry = next.log.at(-1)!;
  const prev = queued;
  session = next;
  options = optionsFor(session.state);
  selection = NONE;
  passScreen(before);
  persist();
  const after = (queued = session.state);
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

/**
 * Plays the actions of a click in order (a walk is several moves), then
 * selects `after` if it can still act.
 */
function play(actions: readonly Action[], after: Selection = NONE) {
  const start = session.record.actions.length + (online?.pending ?? 0);
  for (const action of actions) if (!perform(action)) return;
  lastWalk =
    actions.length > 1 && actions.every((a) => a.type === 'move')
      ? { end: start + actions.length, size: actions.length }
      : null;
  // Online the selection comes back once the server has confirmed the actions.
  if (online) online.after = after;
  else select(carryOver(after, options));
}

/** Takes back the last move, or the whole last walk if it was made in one click. */
function undoLast() {
  const length = session.record.actions.length;
  const walk = lastWalk;
  lastWalk = null;
  if (online) requestUndo(online, walk?.end === length ? length - walk.size : length - 1);
  else setSession(walk?.end === length ? truncate(session, length - walk.size) : undo(session));
}

function undoAll() {
  if (online) requestUndo(online, onlineFloor(online.log));
  else setSession(undoTurn(session));
}

const undoable = () => (online ? onlineFloor(online.log) < online.log.length : canUndo(session));

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
  if (result.actions) play(result.actions, result.selection);
  else select(result.selection);
}

function startGame(players: number, newSeats: Seat[], seed: number) {
  if (online) return;
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
  if (online || !botTurn() || curtain !== null || botRequest !== null) return;
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
  if (online) return;
  if (botRequest !== null && botRequest !== session.record.actions.length) {
    bots.cancel();
    botRequest = null;
  }
}

// --- Rendering -------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A message at the bottom of the board: an error, or news when `info`. */
function toast(text: string, duration = 4000, info = false) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.toggle('info', info);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), duration);
}

const name = (id: string) => placeName(board(), id);

function renderControls() {
  const controls = $('#controls');
  const { state } = session;
  if (state.phase === 'over' && shown.phase === 'over') {
    const { winners } = score(state);
    controls.replaceChildren(
      h('p', { className: 'offer' }, `${winners.map(playerName).join(' and ')} won.`),
      h(
        'div',
        { className: 'row' },
        online
          ? button('Leave room', () => leaveOnline(), { className: 'primary' })
          : button('New game', openSetup, { className: 'primary' }),
      ),
    );
    return;
  }
  const away: Node[] = online && amAway() ? [awayNotice()] : [];
  if (botTurn() || animator.busy || online?.pending) {
    const p = state.current;
    let text: string;
    if (online) {
      const seat = online.room?.seats[p];
      const who = `${playerName(p)} (${labels()[p]?.long ?? 'you'})`;
      const watching = online.inGame && mySeat() === null ? ' You are watching.' : '';
      text = !online.inGame
        ? 'Waiting for the game to start.'
        : animator.busy
          ? `${who} is moving…`
          : online.pending
            ? 'Waiting for the server…'
            : seat?.type === 'bot' || (seat?.type === 'human' && seat.away)
              ? `${who} is thinking…`
              : `${who} is playing.`;
      text += watching;
    } else {
      const status = botTurn()
        ? curtain !== null
          ? 'waits for the screen to be shown.'
          : bots.thinking
            ? 'is thinking…'
            : 'is moving…'
        : 'is moving…';
      text = `${playerName(p)} (${SEAT_NAMES[seats[p] ?? 'human']}) ${status}`;
    }
    controls.replaceChildren(...away, h('p', { className: 'hint' }, swatch(p), ` ${text}`));
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
        button('Undo (Z)', undoLast, {
          disabled: !undoable(),
          title: 'Take back the last move',
        }),
        button('Undo turn', undoAll, {
          disabled: !undoable(),
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
        'Click a green node to walk there (a number on the ring is the MP it takes), an orange castle to walk to it and attack (the count moves in on a win), or a red marker to attack it (walking next to it first if needed).',
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

let trailsShown = '';
/** Arrows for what the others did since the viewer's last turn, as far as the board shows. */
function renderTrails() {
  const me = viewer() ?? shown.current;
  const key = `${shownLength}:${me}`;
  if (key === trailsShown) return;
  trailsShown = key;
  scene.showTrails(trailsOf(sinceLastTurn(session.log.slice(0, shownLength), me)));
}

/** Turn (and player) last greeted with a summary and their stacks lighting up. */
let greeted = '';
/** Once the board has caught up at the start of a human's turn, sums up what happened. */
function greet() {
  const { state } = session;
  if (animator.busy || curtain !== null || botTurn() || shown !== state || state.phase !== 'roll')
    return;
  const key = `${state.turn}:${state.current}`;
  if (key === greeted) return;
  greeted = key;
  const p = state.current;
  const text = summary(board(), sinceLastTurn(session.log, p), p);
  if (text) toast(text, 9000, true);
  for (const [id, counts] of Object.entries(state.knights))
    if (counts[p]) void scene.burst(id, scene.colour(p), 900);
}

let logShown = -1;
function renderLog() {
  // The log follows the board: actions still being animated are not listed yet.
  if (shownLength === logShown) return;
  logShown = shownLength;
  const events = session.log.slice(0, shownLength).flatMap((entry) => entry.events);
  const items = logLines(board(), events, placeName).map(({ event, text, nodes }) => {
    const li = h(
      'li',
      { className: event.type === 'rolled' ? 'turn-start' : event.type },
      swatch(event.player),
      ' ',
      text,
    );
    // Hovering an entry points out its nodes on the board.
    if (nodes.length) {
      li.classList.add('points');
      li.onmouseenter = () => scene.showPings(nodes);
      li.onmouseleave = () => scene.showPings([]);
    }
    return li;
  });
  const log = $('#log');
  scene.showPings([]);
  log.replaceChildren(...items);
  log.scrollTop = log.scrollHeight;
}

/** The turn timer, online, while it runs for the player to move. */
const clock = () =>
  online?.deadline != null && online.inGame && shown.phase !== 'over'
    ? `⏱ ${clockText(online.deadline - performance.now())}`
    : '';

function renderStatus() {
  $('#status').replaceChildren(...statusView(viewFor(shown, viewer()), labels(), clock()));
}

function render() {
  const view = viewFor(shown, viewer());
  renderStatus();
  renderControls();
  renderSelection();
  $('#players').replaceChildren(...playersTable(shown, view, labels()));
  $('#new-game').textContent = online ? 'Leave room' : 'New game';
  $('#online-button').hidden = online !== null;
  $('#room-chip').hidden = online === null;
  if (online) $('#room-chip').textContent = `Room ${online.code}`;
  renderLog();
  renderTrails();
  greet();
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
    ...playersTable(session.state, viewFor(session.state, null), labels()),
  );
  $('#game-over-new').textContent = online ? 'Leave room' : 'New game';
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
$('#new-game').addEventListener('click', () => (online ? leaveOnline() : openSetup()));
$('#game-over-new').addEventListener('click', () => (online ? leaveOnline() : openSetup()));
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

// --- Online ----------------------------------------------------------------------

function sendAction(o: Online, action: Action): boolean {
  if (!o.conn.send({ type: 'act', action, at: session.log.length + o.pending })) {
    toast('Not connected to the server; reconnecting…');
    return false;
  }
  o.pending++;
  selection = NONE;
  render();
  return true;
}

/** Asks the server to take the game back to its first `to` actions (own moves only). */
function requestUndo(o: Online, to: number) {
  const length = o.log.length;
  const target = Math.max(to, onlineFloor(o.log));
  if (o.pending || target >= length) return;
  if (o.conn.send({ type: 'undo', to: target, at: length })) {
    o.pending++;
    render();
  }
}

function awayNotice(): Node {
  return h(
    'p',
    { className: 'offer away' },
    'A bot is playing for you. ',
    button("I'm back", () => online?.conn.send({ type: 'back' }), { className: 'primary' }),
  );
}

let lobbyScreen: LobbyScreen | null = null;

/** Shows the online dialog (`null` hides it). */
function showLobby(screen: LobbyScreen | null) {
  lobbyScreen = screen;
  $('#online').hidden = screen === null;
  if (screen) renderLobby($('#online-dialog'), screen, lobbyHandlers);
  render();
}

function entryScreen(change: Partial<Extract<LobbyScreen, { kind: 'entry' }>> = {}): LobbyScreen {
  const current = lobbyScreen?.kind === 'entry' ? lobbyScreen : null;
  return {
    kind: 'entry',
    name: current?.name ?? onlineStore.name,
    code: current?.code ?? '',
    players: current?.players ?? 3,
    error: null,
    busy: false,
    configured: server !== null,
    ...change,
  };
}

function rememberName(name: string) {
  onlineStore = { ...onlineStore, name };
  saveOnline(localStorage, onlineStore);
}

const lobbyHandlers: LobbyHandlers = {
  async create(name, players) {
    if (!server) return;
    rememberName(name);
    showLobby(entryScreen({ name, players, busy: true }));
    try {
      const { code, token } = await createRoom(server, name, players);
      onlineStore = rememberToken(onlineStore, code, token);
      saveOnline(localStorage, onlineStore);
      connectOnline(code);
    } catch (e) {
      showLobby(
        entryScreen({
          name,
          players,
          error: `Could not create a room: ${e instanceof Error ? e.message : String(e)}`,
        }),
      );
    }
  },
  join(name, text) {
    const code = normaliseCode(text);
    rememberName(name);
    if (!code) showLobby(entryScreen({ name, code: text, error: 'That is not a room code.' }));
    else connectOnline(code);
  },
  send: (msg) => online?.conn.send(msg),
  leave: () => leaveOnline(),
  cancel: () => showLobby(null),
  copyLink,
};

const inviteLink = (code: string) =>
  `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;

function copyLink() {
  if (!online) return;
  const link = inviteLink(online.code);
  navigator.clipboard?.writeText(link).then(
    () => toast(`Invite link copied: ${link}`, 4000, true),
    () => toast(link, 8000, true),
  );
}

/** Puts the room in the address bar, so a refresh comes back to it. */
function setRoomUrl(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

/** Joins a room (with the stored token, if this browser was in it before). */
function connectOnline(code: string) {
  if (!server) return;
  if (online) closeOnline();
  bots.cancel();
  botRequest = null;
  const conn = new Connection(
    socketUrl(server, code),
    () => {
      const token = onlineStore.tokens[code];
      const name = onlineStore.name || 'Player';
      return token ? { type: 'hello', name, token } : { type: 'hello', name };
    },
    () => roomExists(server, code),
  );
  online = {
    code,
    conn,
    me: null,
    room: null,
    log: [],
    inGame: false,
    pending: 0,
    after: null,
    duty: null,
    deadline: null,
  };
  const o = online;
  conn.onMessage = (msg) => online === o && onServer(o, msg);
  conn.onStatus = (status) => online === o && onStatus(o, status);
  setRoomUrl(code);
  gameOverSeen = true;
  $('#game-over').hidden = true;
  $('#setup').hidden = true;
  // An empty board until the game starts.
  setSession(newSession({ players: 3 }, 0));
  showLobby({ kind: 'connecting', code, text: 'Connecting…' });
}

function onStatus(o: Online, status: ConnectionStatus) {
  if (status === 'gone') {
    const code = o.code;
    onlineStore = forgetToken(onlineStore, code);
    saveOnline(localStorage, onlineStore);
    leaveOnline(false);
    showLobby(entryScreen({ code, error: `Room ${code} does not exist (any more).` }));
    return;
  }
  if (status === 'connecting') {
    o.pending = 0;
    o.after = null;
    if (!o.inGame && lobbyScreen?.kind !== 'room')
      showLobby({ kind: 'connecting', code: o.code, text: 'Connecting…' });
    else if (lobbyScreen?.kind === 'room') showLobby({ ...lobbyScreen, status });
    else toast('Connection lost; reconnecting…', 3000);
  }
  render();
}

function setRoom(o: Online, room: RoomInfo) {
  o.room = room;
  o.deadline = room.deadlineIn === null ? null : performance.now() + room.deadlineIn;
}

function onServer(o: Online, msg: ServerMessage) {
  switch (msg.type) {
    case 'welcome':
      o.me = msg.you.id;
      onlineStore = rememberToken(onlineStore, o.code, msg.you.token);
      saveOnline(localStorage, onlineStore);
      setRoom(o, msg.room);
      o.pending = 0;
      o.after = null;
      runDuty(o, null); // the server sends the duty again if this tab is the AI host
      if (msg.game) loadSnapshot(o, msg.game);
      else {
        o.inGame = false;
        showLobby({ kind: 'room', room: msg.room, me: o.me, status: o.conn.status });
      }
      break;
    case 'room':
      setRoom(o, msg.room);
      if (msg.room.phase === 'lobby')
        showLobby({ kind: 'room', room: msg.room, me: o.me, status: o.conn.status });
      else render();
      break;
    case 'game':
      loadSnapshot(o, msg.game);
      scene.rig.go('overview');
      break;
    case 'action':
      applyRemote(o, msg.at, msg.entry, msg.view);
      break;
    case 'undone':
      o.log.length = msg.length;
      o.pending = 0;
      o.after = null;
      lastWalk = null;
      setSession(mirror(msg.view, o.log));
      break;
    case 'duty':
      runDuty(o, msg.duty);
      break;
    case 'error':
      if (o.pending) {
        o.pending = 0;
        o.after = null;
      }
      if (msg.code !== 'stale') toast(msg.message);
      render();
      break;
    case 'closed':
      toast(msg.reason, 6000, true);
      break;
  }
}

function loadSnapshot(o: Online, game: { view: GameView; log: LogEntry[] }) {
  o.log = [...game.log];
  o.inGame = true;
  o.pending = 0;
  o.after = null;
  lastWalk = null;
  gameOverSeen = game.view.phase === 'over';
  showLobby(null);
  setSession(fromSnapshot(game));
}

/** One more action from the server: animate it like a local one. */
function applyRemote(o: Online, at: number, entry: LogEntry, view: GameView) {
  if (at !== o.log.length) {
    // Out of step (should not happen): a fresh welcome brings the whole game.
    o.conn.resync();
    return;
  }
  o.log.push(entry);
  const { action, events } = entry;
  advance({
    record: { ...session.record, actions: [...session.record.actions, action] },
    state: stateFromView(view),
    log: [...session.log, { action, events }],
  });
  if (o.pending && !entry.auto && action.player === mySeat()) {
    o.pending--;
    if (!o.pending && o.after) {
      const after = o.after;
      o.after = null;
      select(carryOver(after, options));
    }
  }
}

/** Seed of the bot a seat gets in this room, so it keeps its plan across requests. */
function botSeed(code: string, seat: PlayerId) {
  let hash = seat;
  for (const c of code) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
  return hash;
}

let dutyRun = 0;

/**
 * As AI host this tab plays the seats the server asks for: the bot gets the
 * observation from the server, and its action waits for the animations and
 * the bot delay, like a local bot's.
 */
function runDuty(o: Online, duty: Duty | null) {
  o.duty = duty;
  const run = ++dutyRun;
  bots.cancel();
  if (!duty) return;
  const asked = performance.now();
  bots
    .request(duty.seat, duty.level, botSeed(o.code, duty.seat), duty.obs)
    .then(async (action) => {
      await animator.whenIdle();
      const wait = BOT_DELAY[settings.botSpeed] - (performance.now() - asked);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await animator.whenIdle();
      if (run !== dutyRun || online !== o || !action) return;
      o.duty = null;
      o.conn.send({ type: 'act', action, at: duty.at });
    })
    .catch((err: unknown) =>
      toast(`Bot error: ${err instanceof Error ? err.message : String(err)}`),
    );
}

/** Closes the room's socket and stops playing bots for it. */
function closeOnline() {
  const o = online;
  if (!o) return;
  online = null;
  dutyRun++;
  bots.cancel();
  o.conn.close();
}

/**
 * Leaves the room and goes back to the local game. In the lobby or when
 * watching the server forgets the member; a player in a running game keeps
 * their token and can come back with the invite link while a bot plays for
 * them.
 */
function leaveOnline(tell = true) {
  const o = online;
  if (!o) return;
  const playing = o.inGame && mySeat() !== null && session.state.phase !== 'over';
  if (
    tell &&
    playing &&
    !confirm('Leave the game? A bot plays for you until you come back with the room link.')
  )
    return;
  if (tell) o.conn.send({ type: 'leave' });
  if (!playing) {
    onlineStore = forgetToken(onlineStore, o.code);
    saveOnline(localStorage, onlineStore);
  }
  closeOnline();
  setRoomUrl(null);
  showLobby(null);
  const saved = loadGame(localStorage);
  seats = saved?.seats ?? ['human', 'medium', 'medium'];
  gameOverSeen = true;
  $('#game-over').hidden = true;
  setSession(saved?.session ?? newSession({ players: 3 }, randomSeed()));
  if (!saved) openSetup();
}

$('#online-button').addEventListener('click', () => showLobby(entryScreen({ error: null })));
$('#room-chip').addEventListener('click', copyLink);
// The turn timer counts down between room updates.
setInterval(() => {
  if (online?.deadline != null) renderStatus();
}, 1000);

// --- Settings ------------------------------------------------------------------

function applySettings() {
  animator.speed = ANIMATION_SPEED[settings.animations];
  scene.setLabels(settings.labels);
  scene.setTrailsVisible(settings.trails);
  $<HTMLSelectElement>('#bot-speed').value = settings.botSpeed;
  $<HTMLSelectElement>('#animations').value = settings.animations;
  $<HTMLInputElement>('#pass-screen').checked = settings.passScreen;
  $<HTMLInputElement>('#labels').checked = settings.labels;
  $<HTMLInputElement>('#trails').checked = settings.trails;
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
$<HTMLInputElement>('#trails').addEventListener('change', (e) =>
  updateSettings({ trails: (e.target as HTMLInputElement).checked }),
);

// --- Camera ----------------------------------------------------------------------

/**
 * Step of the Zoom cycle without a selection: 0 fits all of the viewer's
 * stacks, 1, 2… zoom on each stack, largest first. Pressing Zoom again while
 * the camera is still where the last press put it goes to the next step.
 */
let zoomStep = 0;

/** The points the Zoom preset looks at: the selection, else the viewer's knights. */
function focusPoints(): Point[] {
  const id =
    selection.kind === 'stack'
      ? selection.from
      : selection.kind === 'attack'
        ? selection.target
        : null;
  if (id) return [scene.nodePoint(id)];
  const p = viewer() ?? session.state.current;
  const stacks = Object.entries(shown.knights)
    .filter(([, c]) => (c[p] ?? 0) > 0)
    .sort(([, a], [, b]) => (b[p] ?? 0) - (a[p] ?? 0))
    .map(([id]) => scene.nodePoint(id));
  if (stacks.length < 2) return stacks;
  zoomStep = scene.rig.current === 'focus' ? (zoomStep + 1) % (stacks.length + 1) : 0;
  return zoomStep === 0 ? stacks : [stacks[zoomStep - 1]!];
}

function camera(preset: Preset) {
  scene.rig.go(preset, preset === 'focus' ? focusPoints() : []);
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
  if (!$('#setup').hidden || !$('#online').hidden) return;
  const cams: Record<string, Preset> = { '1': 'overview', '2': 'table', '3': 'focus' };
  if (e.key in cams) {
    camera(cams[e.key]!);
    return;
  }
  if (e.key === 'l') {
    updateSettings({ labels: !settings.labels });
    return;
  }
  if (e.key === 't') {
    updateSettings({ trails: !settings.trails });
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
      undoLast();
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
  scene.rig.insetTop = $('.topbar').getBoundingClientRect().bottom;
  const bottomSheet = panel.left < 20;
  const width = bottomSheet ? window.innerWidth : panel.left - 10;
  const height = bottomSheet ? panel.top + 12 : window.innerHeight;
  canvas.style.width = `${Math.max(1, width)}px`;
  canvas.style.height = `${Math.max(1, height)}px`;
  scene.resize();
}

new ResizeObserver(layout).observe($('#panel'));
window.addEventListener('resize', layout);

/** Draw every n-th frame only; browser tests turn this up to save CPU. */
let drawEvery = 1;
let frame = 0;
scene.renderer.setAnimationLoop((now) => {
  scene.render(now, frame++ % drawEvery === 0);
  die.update(now);
});

applySettings();
if (window.matchMedia('(max-width: 760px)').matches) $('#log-box').classList.add('collapsed');
layout();
scene.rig.go('overview', [], true);
if (
  settings.passScreen &&
  session.record.actions.length &&
  seats.filter((s) => s === 'human').length > 1
)
  curtain = viewer();
snap();
// An invite link (or a refresh in a room) opens the room straight away.
const roomParam = new URLSearchParams(location.search).get('room');
const roomCode = roomParam ? normaliseCode(roomParam) : null;
if (roomCode && server) {
  if (onlineStore.name || onlineStore.tokens[roomCode]) connectOnline(roomCode);
  else showLobby(entryScreen({ code: roomCode }));
} else if (!saved) openSetup();

// Lets browser tests find nodes on screen and read the game (dev server only).
if (import.meta.env.DEV)
  Object.assign(window, {
    hrady: {
      screenPoint: (id: string) => scene.screenPoint(id),
      session: () => session,
      online: () =>
        online && {
          code: online.code,
          me: online.me,
          seat: mySeat(),
          room: online.room,
          inGame: online.inGame,
          pending: online.pending,
          duty: online.duty && { seat: online.duty.seat, at: online.duty.at },
          connected: online.conn.connected,
        },
      interactive: () => interactive(),
      drawEvery: (n: number) => (drawEvery = Math.max(1, Math.floor(n))),
      perform: (action: Action) => perform(action),
      legal: () => legalActions(session.state, session.state.current),
      view: () => viewFor(shown, viewer()),
      busy: () => animator.busy,
      look: (id: string) => scene.rig.go('focus', [scene.nodePoint(id)], true),
      moves: () => [...options.moves].map(([from, to]) => [from, [...to]]),
      castles: () => [...options.castles].map(([from, to]) => [from, [...to]]),
      fields: () => [...options.fields].map(([target, from]) => [target, [...from]]),
      reach: (id: string) =>
        [...targetsFor(options, id).paths].map(([to, path]) => [to, path.length]),
    },
  });
