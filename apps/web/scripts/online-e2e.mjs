// End-to-end check of online play: several browser contexts play a whole game
// against `wrangler dev`, with AI seats, a refresh, the host dropping out (AI
// hand-off and bot takeover) and a spectator joining late. Every WebSocket
// frame a client receives is checked for hidden shield values.
//
//   pnpm dev:server &   pnpm dev:web &
//   node apps/web/scripts/online-e2e.mjs
//
// Needs Playwright with Chromium (not a dependency of the repo). Options via
// environment: WEB (default http://127.0.0.1:5173), BOTS (default
// "medium,easy": the levels of the AI seats after the three humans).
import { createRequire } from 'node:module';

// Resolved like `require`, so a global Playwright install (NODE_PATH) works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const WEB = process.env.WEB ?? 'http://127.0.0.1:5173';
const BOTS = (process.env.BOTS ?? 'medium,easy').split(',').filter(Boolean);
const HUMANS = ['Ann', 'Bea', 'Cid'];
const players = HUMANS.length + BOTS.length;
const started = Date.now();
const log = (...args) => console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s]`, ...args);
const fail = (msg) => {
  console.error('FAIL:', msg);
  process.exit(1);
};

const browser = await chromium.launch();
const problems = [];

/** Hidden information a frame must never carry for its recipient. */
function checkFrame(name, text) {
  if (text === 'pong') return;
  if (/"(seed|rng)"/.test(text)) problems.push(`${name} got a seed or RNG state`);
  const msg = JSON.parse(text);
  const views = [];
  if (msg.view) views.push(msg.view);
  if (msg.game?.view) views.push(msg.game.view);
  if (msg.duty?.obs) views.push(msg.duty.obs.view);
  for (const view of views)
    for (const [id, c] of Object.entries(view.castles))
      if (c.shield && !c.shield.revealed && c.shield.value !== null && c.owner !== view.viewer)
        problems.push(`${name} saw the hidden shield on ${id}`);
}

async function open(name, path = '/') {
  // Small windows, drawn about once a second: every page renders the board in software.
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
  await context.addInitScript(() => {
    if (location.protocol.startsWith('http'))
      localStorage.setItem(
        'hrady-settings',
        JSON.stringify({ animations: 'off', botSpeed: 'fast', passScreen: false }),
      );
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('websocket', (ws) => ws.on('framereceived', (f) => checkFrame(name, String(f.payload))));
  await page.goto(WEB + path);
  await page.waitForFunction(() => window.hrady);
  await page.evaluate(() => window.hrady.drawEvery(60));
  return { name, context, page };
}

const online = (c) => c.page.evaluate(() => window.hrady.online());
const logLength = (c) => c.page.evaluate(() => window.hrady.session().log.length);

/** Plays one action for a human whose turn it is: attacks first, else a random move. */
const step = (c) =>
  c.page.evaluate(() => {
    const h = window.hrady;
    if (!h?.interactive() || h.busy()) return false;
    const legal = h.legal();
    const first = (type) => legal.find((a) => a.type === type);
    const moves = legal.filter((a) => a.type === 'move');
    const mp = h.session().state.mp;
    const action =
      first('roll') ??
      first('placeShield') ??
      first('attackCastle') ??
      first('attackField') ??
      (mp > 0 && moves.length && Math.random() < 0.85
        ? moves[Math.floor(Math.random() * moves.length)]
        : first('endTurn'));
    return action ? h.perform(action) : false;
  });

async function join(c, name) {
  await c.page.waitForSelector('#online-name');
  await c.page.fill('#online-name', name);
  await c.page.click('#online-join');
}

// --- Lobby ---------------------------------------------------------------------

const ann = await open('Ann');
await ann.page.waitForSelector('#setup:not([hidden])');
await ann.page.click('#setup-cancel');
await ann.page.click('#online-button');
await ann.page.fill('#online-name', 'Ann');
await ann.page.selectOption('#online-players', String(players));
await ann.page.click('#online-create');
await ann.page.waitForSelector('#room-code');
const code = (await ann.page.textContent('#room-code')).trim();
log('room', code);

const humans = [ann];
for (const name of HUMANS.slice(1)) {
  const c = await open(name, `/?room=${code}`);
  await join(c, name);
  await c.page.waitForSelector('#room-code');
  humans.push(c);
}
await ann.page.waitForFunction(
  (n) => window.hrady.online()?.room?.seats.filter((s) => s.type === 'human').length === n,
  HUMANS.length,
);
for (const [i, level] of BOTS.entries())
  await ann.page.selectOption(`#online-seats tr:nth-child(${HUMANS.length + i + 1}) select`, level);
await ann.page.selectOption('select[aria-label="Turn timer"]', '60');
await ann.page.click('#online-start:not([disabled])');
for (const c of humans) await c.page.waitForSelector('#online', { state: 'hidden' });
log('game started:', HUMANS.join(', '), '+', BOTS.join(', '));

// --- Play ----------------------------------------------------------------------

let spectator = null;
let refreshed = false;
let hostGone = null;
let goneAt = 0;
let hostBack = false;
let sawHandOff = false;
let sawAway = false;
const deadline = Date.now() + 25 * 60_000;

for (;;) {
  if (Date.now() > deadline) fail('the game did not finish in time');
  const present = humans.filter((c) => c !== hostGone);
  for (const c of present) await step(c);
  const ref = present[present.length - 1];
  const length = await logLength(ref);
  const state = await ref.page.evaluate(() => window.hrady.session().state.phase);
  if (state === 'over') {
    if (hostGone) {
      const info = await ref.page.evaluate(() => {
        const s = window.hrady.session();
        return {
          length: s.log.length,
          turn: s.state.turn,
          last: s.log.slice(-3),
          castles: Object.values(s.state.castles).filter((c) => c.owner !== null).length,
        };
      });
      fail(`game over while the host is away: ${JSON.stringify(info)}`);
    }
    break;
  }

  if (!spectator && length >= 10) {
    spectator = await open('Dan', `/?room=${code}`);
    await join(spectator, 'Dan');
    await spectator.page.waitForFunction(() => window.hrady.online()?.inGame);
    const o = await online(spectator);
    if (o.seat !== null) fail('a late joiner got a seat');
    log('spectator joined at action', length);
  }

  if (!refreshed && length >= 25) {
    refreshed = true;
    const bea = humans[1];
    await bea.page.reload();
    await bea.page.waitForFunction(() => window.hrady?.online()?.inGame);
    await bea.page.evaluate(() => window.hrady.drawEvery(60));
    const o = await online(bea);
    if (o.seat !== 1) fail(`Bea came back in seat ${o.seat}`);
    log('Bea refreshed at action', length, 'and has her seat back');
  }

  if (!hostGone && !hostBack && length >= 40) {
    hostGone = ann;
    goneAt = length;
    await ann.page.goto('about:blank');
    log('Ann (the host) left at action', length);
  }

  if (hostGone && !hostBack) {
    const o = await online(ref);
    const annSeat = o.room.seats[0];
    if (o.room.host !== 'm1') sawHandOff = true;
    if (annSeat.away) sawAway = true;
    // Back once a bot has played for her for a while.
    if (sawAway && sawHandOff && length > goneAt + 20) {
      hostBack = true;
      hostGone = null;
      await ann.page.goto(`${WEB}/?room=${code}`);
      await ann.page.waitForFunction(() => window.hrady?.online()?.inGame);
      await ann.page.evaluate(() => window.hrady.drawEvery(60));
      const back = await online(ann);
      if (back.seat !== 0) fail(`Ann came back in seat ${back.seat}`);
      log('Ann is back at action', await logLength(ann), 'host is now', back.room.host);
    }
  }
  await new Promise((r) => setTimeout(r, 60));
}

// --- Checks --------------------------------------------------------------------

const everyone = [...humans, spectator];
for (const c of everyone) await c.page.waitForFunction(() => !window.hrady.busy());
const lengths = await Promise.all(everyone.map(logLength));
if (new Set(lengths).size !== 1) fail(`clients disagree on the log: ${lengths}`);
const winners = await ann.page.textContent('#controls .offer');
log('game over after', lengths[0], 'actions:', winners.trim());
const spectatorView = await spectator.page.evaluate(() => window.hrady.view());
if (spectatorView.viewer !== null || spectatorView.ownShields !== null)
  fail('the spectator sees a player view');
if (!sawHandOff) fail('the AI host was never handed over');
if (!sawAway) fail('no bot took over the absent host');
await ann.page.evaluate(() => window.hrady.drawEvery(1));
await ann.page.waitForTimeout(500);
await ann.page.screenshot({ path: process.env.SCREENSHOT ?? 'online-e2e.png' });
if (problems.length) fail(problems.slice(0, 10).join('\n'));
log('OK: full game, refresh, host hand-off, takeover, spectator, no leaks');
await browser.close();
