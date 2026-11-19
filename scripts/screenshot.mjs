// Real-UI screenshots of PocketScholar via Chrome DevTools Protocol.
//
// Prerequisites (all free, no install):
//   1. Dev server running:  npm run dev  (http://127.0.0.1:5173)
//   2. Headless Chromium with remote debugging, e.g. the Playwright cache:
//        ~/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome \
//          --headless=new --no-sandbox --disable-gpu \
//          --remote-debugging-port=9222 --user-data-dir=/tmp/pocketscholar-chrome
//      (No `google-chrome` binary is installed on this VM — that is why this
//      script drives the Playwright-cached Chromium over CDP instead.)
//
// Run:  node scripts/screenshot.mjs
// Output: screenshots/*.png (welcome, editor, study summary / flashcards /
// quiz on desktop, plus welcome + study on a mobile viewport).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_URL = process.env.POCKETSCHOLAR_URL ?? 'http://127.0.0.1:5173';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9222';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal CDP client over the browser-level WebSocket (Node's global WebSocket). */
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
  }

  ready() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  /** Wait until `predicate(event)` matches a received CDP event (or timeout). */
  async waitForEvent(predicate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const idx = this.events.findIndex(predicate);
      if (idx !== -1) return this.events.splice(idx, 1)[0];
      await sleep(100);
    }
    throw new Error('Timed out waiting for CDP event');
  }
}

async function evalJs(cdp, sessionId, expression) {
  const res = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (res.exceptionDetails) {
    throw new Error(`JS error: ${JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)}`);
  }
  return res.result?.value;
}

async function waitFor(cdp, sessionId, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evalJs(cdp, sessionId, expression)) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function shot(cdp, sessionId, file) {
  const overflow = await evalJs(
    cdp,
    sessionId,
    `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
  );
  if (overflow > 0) {
    console.warn(`WARNING: horizontal overflow of ${overflow}px in ${file}`);
  }
  const { data } = await cdp.send(
    'Page.captureScreenshot',
    { format: 'png' },
    sessionId,
  );
  writeFileSync(join(OUT_DIR, file), Buffer.from(data, 'base64'));
  console.log(`wrote screenshots/${file}`);
}

async function openTab(cdp, url, width, height, mobile = false) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile },
    sessionId,
  );
  await cdp.send('Page.navigate', { url }, sessionId);
  await cdp.waitForEvent(
    (e) => e.method === 'Page.loadEventFired' && e.sessionId === sessionId,
  );
  await waitFor(cdp, sessionId, `document.querySelector('#root')?.children.length > 0`);
  await sleep(600); // let React render + IndexedDB load settle
  return { targetId, sessionId };
}

async function closeTab(cdp, targetId, sessionId) {
  await cdp.send('Target.detachFromTarget', { sessionId });
  await cdp.send('Target.closeTarget', { targetId });
}

async function clickButton(cdp, sessionId, label) {
  const clicked = await evalJs(
    cdp,
    sessionId,
    `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`,
  );
  if (!clicked) throw new Error(`Button not found: ${label}`);
}

async function resetLibrary(cdp, sessionId) {
  await evalJs(
    cdp,
    sessionId,
    `new Promise((resolve) => { const r = indexedDB.deleteDatabase('pocketscholar'); r.onsuccess = r.onerror = r.onblocked = () => { localStorage.clear(); resolve(true); }; })`,
  );
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const version = await (await fetch(`${CDP_HTTP}/json/version`)).json();
  const cdp = new Cdp(version.webSocketDebuggerUrl);
  await cdp.ready();
  console.log(`Connected to ${version.Browser}`);

  // 1. Welcome screen (desktop, empty library).
  let tab = await openTab(cdp, `${DEV_URL}/`, 1280, 900);
  await shot(cdp, tab.sessionId, '01-welcome-desktop.png');
  await closeTab(cdp, tab.targetId, tab.sessionId);

  // 2. Editor with the sample note loaded via ?sample= deep link.
  tab = await openTab(cdp, `${DEV_URL}/?sample=photosynthesis`, 1280, 900);
  await waitFor(cdp, tab.sessionId, `document.querySelector('.content-input')?.value.length > 100`);
  await shot(cdp, tab.sessionId, '02-editor-sample-desktop.png');

  // 3. Study pack: click Generate, wait for the panel, summary tab.
  await clickButton(cdp, tab.sessionId, 'Generate study pack');
  await waitFor(cdp, tab.sessionId, `!!document.querySelector('.study')`, 90000); // cloud can take 16 s+ via proxy — 15 s default timed out once
  await sleep(500);
  await shot(cdp, tab.sessionId, '03-study-summary-desktop.png');

  // 4. Flashcards tab.
  await clickButton(cdp, tab.sessionId, 'Flashcards');
  await sleep(500);
  await shot(cdp, tab.sessionId, '04-study-flashcards-desktop.png');

  // 5. Quiz tab, with the first question answered (shows feedback state).
  await clickButton(cdp, tab.sessionId, 'Quiz');
  await sleep(300);
  await evalJs(cdp, tab.sessionId, `document.querySelector('.quiz-option')?.click()`);
  await sleep(400);
  await shot(cdp, tab.sessionId, '05-study-quiz-desktop.png');
  await closeTab(cdp, tab.targetId, tab.sessionId);

  // 6. Mobile welcome (fresh library, 390x844).
  tab = await openTab(cdp, `${DEV_URL}/`, 390, 844, true);
  await resetLibrary(cdp, tab.sessionId);
  await cdp.send('Page.navigate', { url: `${DEV_URL}/` }, tab.sessionId);
  await cdp.waitForEvent(
    (e) => e.method === 'Page.loadEventFired' && e.sessionId === tab.sessionId,
  );
  await sleep(800);
  await shot(cdp, tab.sessionId, '06-welcome-mobile.png');
  await closeTab(cdp, tab.targetId, tab.sessionId);

  // 7. Mobile study pack (sample + generated, summary tab).
  tab = await openTab(cdp, `${DEV_URL}/?sample=photosynthesis`, 390, 844, true);
  await waitFor(cdp, tab.sessionId, `document.querySelector('.content-input')?.value.length > 100`);
  await clickButton(cdp, tab.sessionId, 'Generate study pack');
  await waitFor(cdp, tab.sessionId, `!!document.querySelector('.study')`, 90000); // cloud can take 16 s+ via proxy — 15 s default timed out once
  await sleep(500);
  await shot(cdp, tab.sessionId, '07-study-mobile.png');
  await closeTab(cdp, tab.targetId, tab.sessionId);

  cdp.ws.close();
  console.log('All screenshots done.');
}

main().catch((err) => {
  console.error('SCREENSHOT FAILED:', err.message);
  process.exit(1);
});
