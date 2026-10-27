import { MAX_PLAYERS, MIN_PLAYERS } from '@hrady/engine';
import {
  BOT_LEVELS,
  MAX_NAME_LENGTH,
  TURN_SECONDS,
  type BotLevel,
  type ClientMessage,
  type RoomInfo,
} from '@hrady/protocol';
import { button, h, swatch } from '../game/hud';
import { playerName } from '../shared/describe';
import type { ConnectionStatus } from './connection';
import { seatName, seatOf, startProblem } from './room';

/** What the online dialog shows. */
export type LobbyScreen =
  | {
      kind: 'entry';
      name: string;
      code: string;
      players: number;
      error: string | null;
      busy: boolean;
      /** `false` when the build has no server URL. */
      configured: boolean;
    }
  | { kind: 'connecting'; code: string; text: string }
  | { kind: 'room'; room: RoomInfo; me: string | null; status: ConnectionStatus };

export interface LobbyHandlers {
  create(name: string, players: number): void;
  join(name: string, code: string): void;
  send(msg: ClientMessage): void;
  leave(): void;
  cancel(): void;
  copyLink(): void;
}

const TIMER_NAMES: Record<number, string> = { 0: 'Off', 60: '1 min', 120: '2 min', 300: '5 min' };

function select<T extends string | number>(
  label: string,
  choices: readonly { value: T; text: string }[],
  value: T,
  onChange: (v: T) => void,
  disabled = false,
): HTMLSelectElement {
  const el = h('select', { ariaLabel: label, disabled });
  for (const c of choices)
    el.append(h('option', { value: String(c.value), selected: c.value === value }, c.text));
  el.onchange = () => {
    const raw = el.value;
    onChange((typeof value === 'number' ? Number(raw) : raw) as T);
  };
  return el;
}

function entry(screen: Extract<LobbyScreen, { kind: 'entry' }>, on: LobbyHandlers): Node[] {
  const name = h('input', {
    id: 'online-name',
    value: screen.name,
    maxLength: MAX_NAME_LENGTH,
    placeholder: 'Your name',
  });
  const code = h('input', {
    id: 'online-code',
    value: screen.code,
    maxLength: 12,
    placeholder: 'Code',
    autocapitalize: 'characters',
    spellcheck: false,
  });
  const players = select(
    'Players',
    [3, 4, 5].map((n) => ({ value: n, text: String(n) })),
    screen.players,
    () => {},
  );
  players.id = 'online-players';
  const needName = () => {
    const n = name.value.trim();
    if (!n) name.focus();
    return n;
  };
  const create = button(
    'Create room',
    () => {
      const n = needName();
      if (n) on.create(n, Number(players.value));
    },
    { className: 'primary', disabled: screen.busy || !screen.configured, id: 'online-create' },
  );
  const join = button(
    'Join',
    () => {
      const n = needName();
      if (n && code.value.trim()) on.join(n, code.value);
      else if (n) code.focus();
    },
    { disabled: screen.busy || !screen.configured, id: 'online-join' },
  );
  code.onkeydown = (e) => e.key === 'Enter' && join.click();
  const out: Node[] = [
    h('h2', {}, 'Play online'),
    h('label', {}, 'Your name ', name),
    h(
      'div',
      { className: 'online-choice' },
      h('h3', {}, 'New room'),
      h('div', { className: 'row' }, 'Players ', players, create),
    ),
    h(
      'div',
      { className: 'online-choice' },
      h('h3', {}, 'Join a room'),
      h('div', { className: 'row' }, code, join),
    ),
  ];
  if (!screen.configured)
    out.push(
      h(
        'p',
        { className: 'hint bad' },
        'This build has no game server configured (VITE_SERVER_URL).',
      ),
    );
  if (screen.error) out.push(h('p', { className: 'hint bad', id: 'online-error' }, screen.error));
  out.push(
    h(
      'p',
      { className: 'hint' },
      'Share the room code with your friends. Computer players run in the host’s browser.',
    ),
    h('div', { className: 'row' }, button('Cancel', on.cancel)),
  );
  return out;
}

function lobby(screen: Extract<LobbyScreen, { kind: 'room' }>, on: LobbyHandlers): Node[] {
  const { room, me } = screen;
  const isHost = room.host === me;
  const mySeat = seatOf(room, me);
  const rows = room.seats.map((seat, p) => {
    const cells: Node[] = [h('td', {}, swatch(p), ` ${playerName(p)}`)];
    const who = h('td', {}, seatName(seat, me));
    if (seat.type === 'human') {
      if (seat.member === room.host) who.append(h('span', { className: 'seat' }, ' host'));
      if (!seat.connected) who.append(h('span', { className: 'seat' }, ' offline'));
    }
    cells.push(who);
    const action = h('td', {});
    if (seat.type === 'open' && mySeat !== p)
      action.append(
        button('Sit here', () => on.send({ type: 'sit', seat: p }), { className: 'sit' }),
      );
    if (isHost && seat.type !== 'human') {
      const kind: 'open' | BotLevel = seat.type === 'bot' ? seat.level : 'open';
      action.append(
        select(
          `${playerName(p)} seat`,
          [
            { value: 'open', text: 'Open' },
            ...BOT_LEVELS.map((l) => ({
              value: l,
              text: seatName({ type: 'bot', level: l }, null),
            })),
          ],
          kind,
          (k) => on.send({ type: 'setSeat', seat: p, kind: k as 'open' | BotLevel }),
        ),
      );
    }
    cells.push(action);
    return h(
      'tr',
      { className: seat.type === 'human' && seat.member === me ? 'current' : '' },
      ...cells,
    );
  });

  const options = h(
    'div',
    { className: 'row' },
    'Players ',
    select(
      'Players',
      Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => ({
        value: MIN_PLAYERS + i,
        text: String(MIN_PLAYERS + i),
      })),
      room.players,
      (n) => on.send({ type: 'setOptions', players: n }),
      !isHost,
    ),
    ' Turn timer ',
    select(
      'Turn timer',
      TURN_SECONDS.map((s) => ({ value: s, text: TIMER_NAMES[s] ?? `${s} s` })),
      room.turnSeconds,
      (s) => on.send({ type: 'setOptions', turnSeconds: s }),
      !isHost,
    ),
  );

  const watchers = room.members.filter((m) => m.seat === null && m.connected);
  const problem = startProblem(room);
  const buttons: Node[] = [];
  if (isHost)
    buttons.push(
      button('Start game', () => on.send({ type: 'start' }), {
        className: 'primary',
        disabled: problem !== null,
        id: 'online-start',
      }),
    );
  if (mySeat !== null) buttons.push(button('Watch instead', () => on.send({ type: 'stand' })));
  buttons.push(button('Leave room', on.leave));

  return [
    h('h2', {}, 'Room ', h('span', { className: 'room-code', id: 'room-code' }, room.code)),
    h(
      'div',
      { className: 'row' },
      button('Copy invite link', on.copyLink),
      h('span', { className: 'hint' }, screen.status === 'open' ? '' : 'Reconnecting…'),
    ),
    h('table', { className: 'seats', id: 'online-seats' }, ...rows),
    options,
    h(
      'p',
      { className: 'hint' },
      watchers.length ? `Watching: ${watchers.map((m) => m.name).join(', ')}. ` : '',
      isHost
        ? (problem ?? 'Everyone is seated.')
        : `Waiting for ${room.members.find((m) => m.id === room.host)?.name ?? 'the host'} to start.`,
      room.turnSeconds
        ? ` A bot plays for anyone idle for ${TIMER_NAMES[room.turnSeconds]} or disconnected.`
        : ' A bot plays for anyone who disconnects.',
    ),
    h('div', { className: 'row' }, ...buttons),
  ];
}

/** Draws the online dialog. */
export function renderLobby(el: HTMLElement, screen: LobbyScreen, on: LobbyHandlers) {
  if (screen.kind === 'entry') el.replaceChildren(...entry(screen, on));
  else if (screen.kind === 'connecting')
    el.replaceChildren(
      h('h2', {}, `Room ${screen.code}`),
      h('p', { className: 'hint' }, screen.text),
      h('div', { className: 'row' }, button('Leave', on.leave)),
    );
  else el.replaceChildren(...lobby(screen, on));
}
