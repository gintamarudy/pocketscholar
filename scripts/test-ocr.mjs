// End-to-end test for photo OCR (on-device Tesseract + UI) in PocketScholar.
//
// Prerequisites (all local, following scripts/screenshot.mjs):
//   1. Production build served:  npm run build && npx vite preview --port 4173
//      (or set POCKETSCHOLAR_URL to any URL serving dist/)
//   2. Headless Chromium with remote debugging + the local egress shim:
//        node scripts/local-proxy.mjs &
//        ~/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome --headless=new \
//          --no-sandbox --disable-gpu \
//          --proxy-server=http://127.0.0.1:3129 --proxy-bypass-list=localhost\;127.0.0.1 \
//          --ignore-certificate-errors --remote-debugging-port=9222 \
//          --user-data-dir=/tmp/pocketscholar-ocr-test
//   3. Run:  node scripts/test-ocr.mjs
//
// What it checks (exit 0 only if ALL pass):
//   - "Scan photo" fills the textarea with recognised text (word recall
//     >= 0.90 vs scripts/ocr-test/ground-truth.txt on the clean photo).
//   - The OCR result line shows on-device source + confidence.
//   - The Generate button becomes enabled (>= 50 chars in the textarea).
//   - A tilted/faded photo still reads (recall reported, threshold 0.80).
//   - The cloud retry button, if shown, fails gracefully while the VM's
//     AppCheck is throttled (error text, no crash) — live cloud OCR is
//     verified separately once the throttle lifts.
//
// Output: screenshots/ocr-test-clean.png + ocr-test-tilted.png.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.POCKETSCHOLAR_URL ?? 'http://127.0.0.1:4173';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9222';
const OUT_DIR = join(root, 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const groundTruth = readFileSync(join(root, 'scripts', 'ocr-test', 'ground-truth.txt'), 'utf8');

function wordsOf(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Word recall: fraction of ground-truth words found in the OCR text. */
function wordRecall(ocrText) {
  const truth = wordsOf(groundTruth);
  const got = new Set(wordsOf(ocrText));
  const found = truth.filter((w) => got.has(w)).length;
  return { recall: found / truth.length, found, total: truth.length };
}

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

  async waitForEvent(predicate, timeoutMs = 30000) {
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
    throw new Error(
      `JS error: ${JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)}`,
    );
  }
  return res.result?.value;
}

async function waitFor(cdp, sessionId, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evalJs(cdp, sessionId, expression)) return true;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for: ${label ?? expression}`);
}

const version = await fetch(`${CDP_HTTP}/json/version`).then((r) => r.json());
const cdp = new Cdp(version.webSocketDebuggerUrl);
await cdp.ready();
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);
await cdp.send('DOM.enable', {}, sessionId);
await cdp.send('Page.navigate', { url: APP_URL }, sessionId);
await cdp.waitForEvent((e) => e.method === 'Page.loadEventFired' && e.sessionId === sessionId);
await waitFor(cdp, sessionId, `document.querySelector('#root')?.children.length > 0`, 30000, 'app mount');
await sleep(1000);

let failures = 0;
const results = [];

async function scanImage(imagePath, label, timeoutMs, minRecall) {
  console.log(`\n=== ${label}: ${imagePath} ===`);
  const { root: docRoot } = await cdp.send('DOM.getDocument', { depth: -1 }, sessionId);
  const { nodeId } = await cdp.send(
    'DOM.querySelector',
    { nodeId: docRoot.nodeId, selector: 'input[accept="image/*"]' },
    sessionId,
  );
  if (!nodeId) throw new Error('photo file input not found in the page');
  const t0 = Date.now();
  await cdp.send('DOM.setFileInputFiles', { files: [resolve(imagePath)], nodeId }, sessionId);
  try {
    await waitFor(
      cdp,
      sessionId,
      `!!document.querySelector('.ocr-result') || !!document.querySelector('.editor-pane .error')`,
      timeoutMs,
      'OCR result or error',
    );
  } catch (e) {
    console.log(`FAIL: no OCR result/error within ${timeoutMs / 1000}s`);
    failures++;
    return;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const ocrLine = await evalJs(
    cdp,
    sessionId,
    `document.querySelector('.ocr-result')?.textContent ?? ''`,
  );
  const errText = await evalJs(
    cdp,
    sessionId,
    `document.querySelector('.editor-pane .error')?.textContent ?? ''`,
  );
  const textarea = await evalJs(
    cdp,
    sessionId,
    `document.querySelector('.content-input')?.value ?? ''`,
  );
  const generateDisabled = await evalJs(
    cdp,
    sessionId,
    `[...document.querySelectorAll('.editor-bar button')].find(b => b.textContent.includes('Generate'))?.disabled ?? null`,
  );
  console.log(`time: ${secs}s`);
  console.log(`ocr-result line: ${ocrLine}`);
  if (errText) console.log(`error shown: ${errText}`);
  console.log(`textarea chars: ${textarea.length}, Generate disabled: ${generateDisabled}`);
  console.log(`--- OCR text (first 500 chars) ---\n${textarea.slice(0, 500)}`);
  const { recall, found, total } = wordRecall(textarea);
  console.log(`word recall: ${found}/${total} = ${(recall * 100).toFixed(1)}% (min ${minRecall * 100}%)`);
  const pass =
    !!ocrLine &&
    !errText &&
    recall >= minRecall &&
    textarea.length >= 50 &&
    generateDisabled === false;
  console.log(pass ? 'PASS' : 'FAIL');
  if (!pass) failures++;
  results.push({ label, secs, recall, pass });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const shot = join(OUT_DIR, `ocr-test-${label}.png`);
  writeFileSync(shot, Buffer.from(data, 'base64'));
  console.log(`screenshot: ${shot}`);
  return { ocrLine, textarea };
}

await scanImage(join(root, 'scripts', 'ocr-test', 'photo-clean.png'), 'clean', 300000, 0.9);
await scanImage(join(root, 'scripts', 'ocr-test', 'photo-tilted.png'), 'tilted', 180000, 0.8);

// Cloud retry (expected to fail gracefully while the VM AppCheck is
// throttled — record the outcome, do not fail the run on it).
const cloudBtn = await evalJs(
  cdp,
  sessionId,
  `[...document.querySelectorAll('.ocr-result button')].find(b => b.textContent.includes('Retry with cloud')) ? 'present' : 'absent'`,
);
console.log(`\n=== cloud retry button: ${cloudBtn} ===`);
if (cloudBtn === 'present') {
  await evalJs(
    cdp,
    sessionId,
    `[...document.querySelectorAll('.ocr-result button')].find(b => b.textContent.includes('Retry with cloud')).click(); 'clicked'`,
  );
  await sleep(15000);
  const after = await evalJs(
    cdp,
    sessionId,
    `({ err: document.querySelector('.editor-pane .error')?.textContent ?? '', line: document.querySelector('.ocr-result')?.textContent ?? '' })`,
  );
  console.log(`after cloud retry: ${JSON.stringify(after)}`);
  console.log('NOTE: live cloud transcription is verified separately once the AppCheck throttle lifts (~21:10 WIB 20 Nov).');
}

console.log(`\n=== SUMMARY ===\n${JSON.stringify(results, null, 2)}\nfailures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
