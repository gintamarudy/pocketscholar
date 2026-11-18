// Diagnose profile-2 pull failure: device id in storage, IndexedDB notes,
// in-page REST fetch of the device's Firestore notes collection.
// The web API key is public client config (it ships in the built bundle),
// but it still lives in .env, not in committed code: pass it via env.
//   FIREBASE_WEB_API_KEY=$(grep VITE_FIREBASE_API_KEY .env | cut -d= -f2) node scripts/diag-pull.mjs
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || '';
if (!WEB_API_KEY) throw new Error('Set FIREBASE_WEB_API_KEY from .env first (see header).');
const CDP_HTTP = 'http://127.0.0.1:9223';
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
      } else if (msg.method) this.events.push(msg);
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
  if (res.exceptionDetails) return 'JS-EXC: ' + JSON.stringify(res.exceptionDetails).slice(0, 500);
  return res.result.value;
}
const targetList = await (await fetch(`${CDP_HTTP}/json/list`)).json();
const page = targetList.find((t) => t.type === 'page');
const cdp = new Cdp(page.webSocketDebuggerUrl);
await cdp.ready();
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.id, flatten: true });
await cdp.send('Runtime.enable', {}, sessionId);
console.log('deviceId in profile2:', await evalJs(cdp, sessionId, `localStorage.getItem('pocketscholar-device-id')`));
console.log('IDB notes:', await evalJs(
  cdp, sessionId,
  `(async () => { const db = await new Promise((res, rej) => { const r = indexedDB.open('pocketscholar'); r.onsuccess = () => res(r.result); r.onerror = () => rej('open-fail'); }); const tx = db.transaction('notes', 'readonly'); const all = await new Promise((res) => { const q = tx.objectStore('notes').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res('ERR'); }); return JSON.stringify(all.map(n => ({ id: n.id, title: n.title }))); })()`,
));
console.log('in-page REST list:', await evalJs(
  cdp, sessionId,
  `(async () => { try { const r = await fetch('https://firestore.googleapis.com/v1/projects/pocketscholar-198d8/databases/(default)/documents/devices/device_lz14qtcimwme4qim/notes?key=${WEB_API_KEY}'); const j = await r.json(); return 'HTTP ' + r.status + ' docs=' + ((j.documents || []).length) + ' ' + JSON.stringify((j.documents || []).map(d => d.name.split('/').pop())); } catch (e) { return 'FETCH-ERR: ' + e.message; } })()`,
));
// Reload once more and wait longer for the slow proxy pull, then re-check.
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5173/' }, sessionId);
await sleep(30000);
console.log('after 30s reload, page has note:', await evalJs(cdp, sessionId, `/Photosynthesis — sample note/.test(document.body.innerText)`));
console.log('IDB notes after reload:', await evalJs(
  cdp, sessionId,
  `(async () => { const db = await new Promise((res, rej) => { const r = indexedDB.open('pocketscholar'); r.onsuccess = () => res(r.result); r.onerror = () => rej('open-fail'); }); const tx = db.transaction('notes', 'readonly'); const all = await new Promise((res) => { const q = tx.objectStore('notes').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res('ERR'); }); return JSON.stringify(all.map(n => ({ id: n.id, title: n.title }))); })()`,
));
process.exit(0);
