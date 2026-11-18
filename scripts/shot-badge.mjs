// One-off: scroll the live study-pack badge into view and screenshot it
// (test-cloud.mjs captures the top of the page; the badge is below the fold).
// Usage: node scripts/shot-badge.mjs [out.png]
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9222';
const OUT = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots', '10-cloud-badge-desktop.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targetList = await (await fetch(`${CDP_HTTP}/json/list`)).json();
const page = targetList.find((t) => t.type === 'page');
if (!page) throw new Error('No page target found on CDP endpoint');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const evalJs = async (sessionId, expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
};
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const badge = await evalJs(sessionId, `(() => { const el = document.querySelector('.badge'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ text: el.textContent.trim(), x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }); })()`);
console.log('badge:', badge);
if (!badge) { console.log('NO-BADGE'); process.exit(1); }
// Tall viewport so the whole page (badge ~y960) fits in one capture.
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1600, deviceScaleFactor: 1, mobile: false }, sessionId);
await evalJs(sessionId, `window.scrollTo(0, 0)`);
await sleep(600);
const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('saved:', OUT);
process.exit(0);
