// Firestore pull-back check (one-off, wiring task 19 Nov).
// Second browser profile: plant the SAME device id in localStorage, reload,
// and confirm the note pushed by the first profile appears via pullNotes.
// Usage: Chromium #2 on CDP 9223; dev server on 5173.
const CDP_HTTP = 'http://127.0.0.1:9223';
const DEV_URL = 'http://127.0.0.1:5173/';
const DEVICE_ID = process.env.DEVICE_ID || 'device_lz14qtcimwme4qim';
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
  if (res.exceptionDetails) throw new Error(`JS exception: ${JSON.stringify(res.exceptionDetails).slice(0, 1000)}`);
  return res.result.value;
}

const targetList = await (await fetch(`${CDP_HTTP}/json/list`)).json();
const page = targetList.find((t) => t.type === 'page');
if (!page) throw new Error('No page target on CDP 9223');
const cdp = new Cdp(page.webSocketDebuggerUrl);
await cdp.ready();
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.id, flatten: true });
await cdp.send('Runtime.enable', {}, sessionId);
await cdp.send('Page.enable', {}, sessionId);

// First load (blank profile) so the origin exists, then plant device id.
await cdp.send('Page.navigate', { url: DEV_URL }, sessionId);
await sleep(5000);
await evalJs(cdp, sessionId, `localStorage.setItem('pocketscholar-device-id', '${DEVICE_ID}'); 'PLANTED:' + localStorage.getItem('pocketscholar-device-id')`);
// Reload: app boots, pullNotes should fetch the note from Firestore.
await cdp.send('Page.navigate', { url: DEV_URL }, sessionId);
await sleep(15000);
const text = await evalJs(cdp, sessionId, `document.body.innerText.slice(0, 1200)`);
console.log('=== PROFILE-2 PAGE TEXT ===\n' + text);
const hasNote = /Photosynthesis — sample note/.test(text);
console.log('=== PULL RESULT: ' + (hasNote ? 'PASS — note from Firestore visible in 2nd profile' : 'FAIL — note NOT visible') + ' ===');
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
const { writeFileSync } = await import('node:fs');
writeFileSync('screenshots/09-firestore-pull-desktop.png', Buffer.from(shot.data, 'base64'));
console.log('=== SCREENSHOT saved: screenshots/09-firestore-pull-desktop.png ===');
process.exit(0);
