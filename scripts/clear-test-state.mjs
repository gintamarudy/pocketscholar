// One-off: clear PocketScholar test state in the cloud Chrome profile
// (CDP 9222) so a retest is independent: delete the pocketscholar IDB only
// (fresh study-pack generate, badge appears only after real completion).
// Deliberately does NOT touch firebase-app-check-database: wiping it mints a
// fresh unregistered debug token and breaks cloud calls until that token is
// registered in the console (seen 19 Nov 01:08 WIB).
// Keeps localStorage device id so Firestore doc continuity holds.
// Usage: node scripts/clear-test-state.mjs
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9222';
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
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:5173/vite.svg' }, sessionId); // same-origin static asset: IDB accessible, app JS not booted (no open IDB connections to block delete)
await sleep(2000);
const out = await evalJs(sessionId, `(async () => {
  const names = ['pocketscholar'];
  const res = {};
  for (const n of names) {
    res[n] = await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(n);
      req.onsuccess = () => resolve('deleted');
      req.onerror = () => resolve('error');
      req.onblocked = () => resolve('blocked');
    });
  }
  return JSON.stringify({ dbsBefore: (await indexedDB.databases()).map((d) => d.name), cleared: res, deviceId: localStorage.getItem('pocketscholar-device-id') });
})()`);
console.log(out);
process.exit(0);
