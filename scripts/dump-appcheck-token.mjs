// One-off: dump the AppCheck debug-token record stored in the cloud Chrome
// profile (CDP 9222) so a wiped token can be restored to the registered one.
// Read-only. Usage: node scripts/dump-appcheck-token.mjs
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
await send('Page.navigate', { url: 'http://127.0.0.1:5173/?sample=photosynthesis' }, sessionId);
await sleep(5000);
const out = await evalJs(sessionId, `(async () => {
  const open = indexedDB.open('firebase-app-check-database');
  const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
  const out = {};
  for (const store of [...db.objectStoreNames]) {
    const tx = db.transaction(store, 'readonly');
    const keys = await new Promise((resolve) => { const r = tx.objectStore(store).getAllKeys(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve([]); });
    const vals = await new Promise((resolve) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve([]); });
    out[store] = keys.map((k, i) => ({ key: String(k), value: vals[i] }));
  }
  db.close();
  return JSON.stringify(out);
})()`);
console.log(out);
process.exit(0);
