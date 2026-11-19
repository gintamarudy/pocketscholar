// End-to-end test for the gallery-upload photo path in PocketScholar.
//
// Bug fixed: the only photo input had capture="environment", which on
// Chrome Android forces the camera with no gallery choice, so a user could
// not upload a screenshot of an assignment from the gallery. The fix adds
// a separate "Upload photo" input WITHOUT capture; both inputs feed the
// same on-device OCR pipeline (scanPhoto).
//
// Prerequisites (all local, following scripts/test-ocr.mjs):
//   1. Production build served:  npm run build && npx vite preview --port 4173
//      (or set POCKETSCHOLAR_URL to any URL serving dist/)
//   2. Headless Chromium with remote debugging + the local egress shim:
//        node scripts/local-proxy.mjs &
//        ~/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome --headless=new \
//          --no-sandbox --disable-gpu \
//          --proxy-server=http://127.0.0.1:3129 --proxy-bypass-list=localhost\;127.0.0.1 \
//          --ignore-certificate-errors --remote-debugging-port=9222 \
//          --user-data-dir=/tmp/pocketscholar-upload-test
//   3. Run:  node scripts/test-upload-gallery.mjs
//
// What it checks (exit 0 only if ALL pass), in a mobile-emulated target
// (Pixel 7 viewport + Android Chrome UA, mirroring the user's phone):
//   - "Scan photo" AND "Upload photo" buttons both exist.
//   - Two input[accept="image/*"]: the Scan one has capture="environment",
//     the Upload one has NO capture attribute (so Android shows the file /
//     gallery chooser instead of forcing the camera).
//   - Uploading a screenshot-style image (1080x1920 PNG, phone UI chrome
//     around the assignment text) through the Upload input fills the
//     textarea with recognised text (word recall >= 0.80 vs
//     scripts/ocr-test/screenshot-ground-truth.txt), shows the on-device
//     OCR result line, and enables Generate (>= 50 chars).
//   - Regression: the Scan input still reads the clean book photo
//     (recall >= 0.90 vs ground-truth.txt).
//
// Output: screenshots/upload-gallery-screenshot.png + upload-gallery-clean.png.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.POCKETSCHOLAR_URL ?? 'http://127.0.0.1:4173';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9222';
const OUT_DIR = join(root, 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wordsOf(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Word recall: fraction of ground-truth words found in the OCR text. */
function wordRecall(ocrText, truthText) {
  const truth = wordsOf(truthText);
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
// Mobile emulation: Pixel 7-ish viewport + Android Chrome UA, mirroring
// the user's phone where the bug was found.
await cdp.send(
  'Emulation.setDeviceMetricsOverride',
  { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true },
  sessionId,
);
await cdp.send(
  'Emulation.setUserAgentOverride',
  {
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  },
  sessionId,
);
await cdp.send('Page.navigate', { url: APP_URL }, sessionId);
await cdp.waitForEvent((e) => e.method === 'Page.loadEventFired' && e.sessionId === sessionId);
await waitFor(cdp, sessionId, `document.querySelector('#root')?.children.length > 0`, 30000, 'app mount');
await sleep(1000);

let failures = 0;
const results = [];

// --- 1. Both buttons exist. ---
const buttons = await evalJs(
  cdp,
  sessionId,
  `[...document.querySelectorAll('.sidebar-actions button')].map(b => b.textContent.trim())`,
);
console.log(`sidebar buttons: ${JSON.stringify(buttons)}`);
for (const label of ['📷 Scan photo', '🖼️ Upload photo']) {
  const ok = buttons.includes(label);
  console.log(`${ok ? 'PASS' : 'FAIL'}: button "${label}" ${ok ? 'present' : 'MISSING'}`);
  if (!ok) failures++;
}

// --- 2. Input attributes: Scan has capture, Upload has none. ---
const captures = await evalJs(
  cdp,
  sessionId,
  `[...document.querySelectorAll('input[accept="image/*"]')].map(i => i.getAttribute('capture'))`,
);
console.log(`photo input capture attributes: ${JSON.stringify(captures)}`);
const attrOk =
  captures.length === 2 && captures[0] === 'environment' && captures[1] === null;
console.log(
  attrOk
    ? 'PASS: Scan input capture="environment", Upload input has NO capture (Android shows the file/gallery chooser)'
    : 'FAIL: expected [environment, null]',
);
if (!attrOk) failures++;

// --- 3. OCR through each input. ---
async function ocrViaInput(inputIndex, imagePath, truthPath, label, timeoutMs, minRecall) {
  console.log(`\n=== ${label}: ${imagePath} (input #${inputIndex}) ===`);
  const truth = readFileSync(truthPath, 'utf8');
  const { root: docRoot } = await cdp.send('DOM.getDocument', { depth: -1 }, sessionId);
  const { nodeIds } = await cdp.send(
    'DOM.querySelectorAll',
    { nodeId: docRoot.nodeId, selector: 'input[accept="image/*"]' },
    sessionId,
  );
  const nodeId = nodeIds[inputIndex];
  if (!nodeId) throw new Error(`photo file input #${inputIndex} not found`);
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
  const { recall, found, total } = wordRecall(textarea, truth);
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
  const shot = join(OUT_DIR, `upload-gallery-${label}.png`);
  writeFileSync(shot, Buffer.from(data, 'base64'));
  console.log(`screenshot: ${shot}`);
}

// Upload path (index 1): screenshot-style image, the user's real flow.
await ocrViaInput(
  1,
  join(root, 'scripts', 'ocr-test', 'screenshot-assignment.png'),
  join(root, 'scripts', 'ocr-test', 'screenshot-ground-truth.txt'),
  'screenshot',
  300000,
  0.8,
);
// Scan path regression (index 0): clean book photo.
await ocrViaInput(
  0,
  join(root, 'scripts', 'ocr-test', 'photo-clean.png'),
  join(root, 'scripts', 'ocr-test', 'ground-truth.txt'),
  'clean',
  300000,
  0.9,
);

console.log(`\n=== SUMMARY ===\n${JSON.stringify(results, null, 2)}\nfailures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
