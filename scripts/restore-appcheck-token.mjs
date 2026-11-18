// One-off: restore the REGISTERED AppCheck debug token into the cloud Chrome
// profile (CDP 9222). The token is read from env var APPCHECK_DEBUG_TOKEN
// (the value registered in the Firebase console for pocketscholar-198d8, see
// WIRING-STATUS.md); a storage wipe had replaced it locally with a fresh
// unregistered token. This only puts the already-registered token back into
// the same browser profile that generated it.
// Usage: APPCHECK_DEBUG_TOKEN=<token> node scripts/restore-appcheck-token.mjs
// NOTE: debug tokens are sensitive — never hardcode one here.
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9222';
const REGISTERED_TOKEN = process.env.APPCHECK_DEBUG_TOKEN;
if (!REGISTERED_TOKEN) throw new Error('Set APPCHECK_DEBUG_TOKEN env var to the registered debug token');
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
await send('Page.navigate', { url: 'http://127.0.0.1:5173/vite.svg' }, sessionId);
await sleep(2000);
const out = await evalJs(sessionId, `(async () => {
  const token = ${JSON.stringify(REGISTERED_TOKEN)};
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('firebase-app-check-database');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('firebase-app-check-store', 'readwrite');
    tx.objectStore('firebase-app-check-store').put({ compositeKey: 'debug-token', value: token }); // in-line key (keyPath=compositeKey), no key arg
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return 'restored debug-token record (value hidden)';
})()`);
console.log(out);
process.exit(0);
