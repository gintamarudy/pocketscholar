// Cloud inference end-to-end test (one-off, wiring task 19 Nov).
// Drives Playwright-cached Chromium over CDP: loads ?sample=photosynthesis,
// captures console (incl. AppCheck debug token line), clicks Generate,
// waits for the study pack, dumps badge text + network failures, screenshots.
// Usage: DEV server running on 127.0.0.1:5173; Chromium started separately
// with --remote-debugging-port=9222. Or set CHROME_BIN / CDP_HTTP.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_URL = process.env.POCKETSCHOLAR_URL ?? 'http://127.0.0.1:5173/?sample=photosynthesis';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9222';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

async function evalJs(cdp, sessionId, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) throw new Error(`JS exception: ${JSON.stringify(res.exceptionDetails)}`);
  return res.result.value;
}

const targetList = await (await fetch(`${CDP_HTTP}/json/list`)).json();
const page = targetList.find((t) => t.type === 'page');
if (!page) throw new Error('No page target found on CDP endpoint');
const cdp = new Cdp(page.webSocketDebuggerUrl);
await cdp.ready();
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.id, flatten: true });
await cdp.send('Runtime.enable', {}, sessionId);
await cdp.send('Log.enable', {}, sessionId);
await cdp.send('Network.enable', {}, sessionId);
await cdp.send('Page.enable', {}, sessionId);

const consoleLines = [];
const netFailures = [];
const netRequests = [];
const genContent = { requestId: null, startedAt: null, status: null, finishedAt: null };
const origPush = cdp.events.push.bind(cdp.events);
// poll events in background via interval
const poll = setInterval(() => {
  for (const ev of cdp.events.splice(0)) {
    if (ev.method === 'Runtime.consoleAPICalled') {
      const args = (ev.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(`[${ev.params.type}] ${args}`);
    } else if (ev.method === 'Runtime.exceptionThrown') {
      consoleLines.push(`[EXCEPTION] ${JSON.stringify(ev.params.exceptionDetails).slice(0, 2000)}`);
    } else if (ev.method === 'Network.loadingFailed') {
      netFailures.push(`${ev.params.errorText} ${ev.params.type ?? ''}`);
    } else if (ev.method === 'Network.requestWillBeSent') {
      const url = ev.params.request.url;
      if (/generateContent/.test(url)) {
        genContent.requestId = ev.params.requestId;
        genContent.startedAt = Date.now();
        consoleLines.push(`[GENCONTENT-START] ${new Date().toISOString()} ${url.slice(0, 160)}`);
      }
    } else if (ev.method === 'Network.responseReceived') {
      const r = ev.params.response;
      if (r.status >= 400) netFailures.push(`HTTP ${r.status} ${r.url}`);
      if (/firebase|googleapis|generativelanguage|appcheck/i.test(r.url)) netRequests.push(`${r.status} ${r.url}`);
      if (/generateContent/.test(r.url)) {
        genContent.status = r.status;
        consoleLines.push(`[GENCONTENT-STATUS] ${new Date().toISOString()} HTTP ${r.status}`);
      }
    } else if (ev.method === 'Network.loadingFinished') {
      if (ev.params.requestId === genContent.requestId) {
        genContent.finishedAt = Date.now();
        consoleLines.push(`[GENCONTENT-FINISHED] ${new Date().toISOString()} after ${((genContent.finishedAt - (genContent.startedAt ?? genContent.finishedAt)) / 1000).toFixed(1)}s`);
        cdp.send('Network.getResponseBody', { requestId: ev.params.requestId }, sessionId)
          .then((b) => {
            const body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
            writeFileSync('/tmp/gencontent-body.json', body.slice(0, 20000));
            consoleLines.push(`[GENCONTENT-BODY] ${body.length} chars, first 500: ${body.slice(0, 500)}`);
          })
          .catch((e) => consoleLines.push(`[GENCONTENT-BODY-ERR] ${e.message}`));
      }
    } else if (ev.method === 'Log.entryAdded') {
      consoleLines.push(`[LOG ${ev.params.entry.level}] ${ev.params.entry.text} ${ev.params.entry.url ?? ''}`);
    }
  }
}, 200);

await cdp.send('Page.navigate', { url: DEV_URL }, sessionId);
await sleep(6000); // let app boot, Firebase init, AppCheck debug token print

const headerText = await evalJs(cdp, sessionId, `document.body.innerText.slice(0, 1500)`);
console.log('=== HEADER/PAGE TEXT (first 1500) ===\n' + headerText);

// Find + click Generate button (poll until the sample note has loaded)
let clicked = 'NO-BUTTON';
for (let i = 0; i < 15; i++) {
  clicked = await evalJs(
    cdp,
    sessionId,
    `(() => { const b = [...document.querySelectorAll('button')].find(x => /Generate study pack/.test(x.textContent) && !x.disabled); if (!b) return 'NO-BUTTON'; b.click(); return 'CLICKED: ' + b.textContent.trim(); })()`,
  );
  if (clicked.startsWith('CLICKED')) break;
  await sleep(2000);
}
console.log('=== GENERATE CLICK ===\n' + clicked);

let badge = null;
let studyText = '';
for (let i = 0; i < 60; i++) {
  await sleep(3000);
  studyText = await evalJs(cdp, sessionId, `document.body.innerText`);
  // Only the result badge counts: element with class "badge" (not the "Will try:" hint)
  const badgeEl = await evalJs(
    cdp,
    sessionId,
    `(() => { const el = document.querySelector('.badge'); return el ? el.textContent.trim() + ' | class=' + el.className : 'NO-BADGE-ELEMENT'; })()`,
  );
  if (badgeEl !== 'NO-BADGE-ELEMENT') { badge = badgeEl; break; }
  if (/AI: Error/.test(studyText)) { badge = 'ERROR-SHOWN-IN-UI'; break; }
}
console.log('=== BADGE ===\n' + (badge ?? 'NONE FOUND after 180s'));
console.log('=== GENCONTENT TIMING ===\n' + JSON.stringify(genContent));
// Device id + sync pill + IndexedDB study packs (for Firestore cross-check)
const deviceInfo = await evalJs(
  cdp,
  sessionId,
  `(() => { const pills = [...document.querySelectorAll('.pill')].map(p => p.textContent.trim()); return JSON.stringify({ deviceId: localStorage.getItem('pocketscholar-device-id'), pills }); })()`,
);
console.log('=== DEVICE/SYNC ===\n' + deviceInfo);
const idbInfo = await evalJs(
  cdp,
  sessionId,
  `(async () => { const dbs = await indexedDB.databases(); const out = []; for (const db of dbs) { const req = indexedDB.open(db.name); const res = await new Promise((resolve) => { req.onsuccess = () => { const d = req.result; const stores = [...d.objectStoreNames]; const counts = {}; let pending = stores.length; if (!pending) { d.close(); resolve({ name: db.name, stores, counts }); } for (const s of stores) { const tx = d.transaction(s, 'readonly'); const cr = tx.objectStore(s).count(); cr.onsuccess = () => { counts[s] = cr.result; if (--pending === 0) { d.close(); resolve({ name: db.name, stores, counts }); } }; cr.onerror = () => { if (--pending === 0) { d.close(); resolve({ name: db.name, stores, counts }); } }; } }; req.onerror = () => resolve({ name: db.name, error: 'open-failed' }); }); out.push(res); } return JSON.stringify(out); })()`,
);
console.log('=== INDEXEDDB ===\n' + idbInfo);
console.log('=== PAGE TEXT (study area, first 3000) ===\n' + studyText.slice(0, 3000));

// Screenshot
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync(join(OUT_DIR, '08-cloud-generate-desktop.png'), Buffer.from(shot.data, 'base64'));
console.log('=== SCREENSHOT saved: screenshots/08-cloud-generate-desktop.png ===');

clearInterval(poll);
// drain remaining events
for (const ev of cdp.events.splice(0)) {
  if (ev.method === 'Runtime.consoleAPICalled') {
    const args = (ev.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    consoleLines.push(`[${ev.params.type}] ${args}`);
  }
}
console.log('=== CONSOLE (' + consoleLines.length + ' lines) ===');
for (const l of consoleLines) console.log(l);
console.log('=== NETWORK FAILURES ===');
for (const l of netFailures) console.log(l);
console.log('=== FIREBASE/GOOGLE NETWORK ===');
for (const l of [...new Set(netRequests)]) console.log(l);
process.exit(0);
