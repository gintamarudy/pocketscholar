// Offline E2E test for the PWA: first online visit installs the service
// worker and precaches the app shell + the whole Tesseract stack; then the
// network is cut (CDP offline emulation, equivalent to Wi-Fi/data off) and
// the app must still open and run on-device OCR.
//
// Usage: POCKETSCHOLAR_URL=http://127.0.0.1:4173 node scripts/test-offline.mjs
// Exits non-zero on any failure. Screenshots to app/screenshots/offline-*.png.
import { spawn } from 'node:child_process';
import { existsSync, globSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.POCKETSCHOLAR_URL ?? 'http://127.0.0.1:4173';
const CDP_PORT = Number(process.env.CDP_PORT ?? 9224);
const PROFILE = '/tmp/pocketscholar-offline-test';
const CHROME = globSync(`${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`)[0];
if (!CHROME) throw new Error('No Playwright Chromium found');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--proxy-server=http://127.0.0.1:3129', '--proxy-bypass-list=localhost;127.0.0.1',
  '--ignore-certificate-errors', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' });

let failures = 0;
const fail = (msg) => { console.error('FAIL:', msg); failures++; };
const ok = (msg) => console.log('ok:', msg);

try {
  // Wait for the DevTools endpoint.
  let targets = null;
  for (let i = 0; i < 30; i++) {
    try {
      targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      break;
    } catch { await sleep(500); }
  }
  if (!targets) throw new Error('Chromium did not start');

  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  const evalJs = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluate failed');
    return r?.result?.value;
  };
  const waitFor = async (expression, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { if (await evalJs(expression)) return true; } catch { /* retry */ }
      await sleep(1000);
    }
    fail(`timed out waiting for: ${label}`);
    return false;
  };

  // 1) First ONLINE visit — app must mount.
  await send('Page.navigate', { url: `${BASE}/` });
  if (!(await waitFor(`document.querySelector('#root')?.children.length > 0`, 20000, 'app mount'))) throw new Error('app did not mount online');
  ok('app mounts online');

  // 2) Manifest must declare PocketScholar.
  const manifest = await evalJs(
    `fetch('/manifest.webmanifest').then(r => r.json()).then(m => JSON.stringify({ name: m.name, icons: m.icons.map(i => i.sizes + ':' + (i.purpose || 'any')) }))`,
    true,
  );
  console.log('manifest:', manifest);
  if (!manifest?.includes('PocketScholar')) fail('manifest name is not PocketScholar');
  else ok('manifest declares PocketScholar');

  // 3) Wait for the service worker to control the page AND precache the
  //    Tesseract language data (the 11 MB download happens in the SW).
  if (!(await waitFor(`navigator.serviceWorker.controller != null`, 30000, 'service worker controlling page'))) throw new Error('no service worker');
  ok('service worker controls the page');
  const precacheOk = await waitFor(
    `(async () => {
       for (const k of await caches.keys()) {
         const c = await caches.open(k);
         const urls = (await c.keys()).map(r => r.url);
         if (urls.some(u => u.includes('tesseract/lang/eng.traineddata.gz')) && urls.some(u => u.includes('tesseract/lang/ind.traineddata.gz'))) return true;
       }
       return false;
     })()`,
    180000, 'precache of Tesseract language data',
  );
  if (!precacheOk) throw new Error('precache did not complete');
  const precacheCount = await evalJs(
    `(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; })()`,
    true,
  );
  console.log('precache entries in Cache Storage:', precacheCount);
  ok('Tesseract language data precached (eng + ind)');

  // 4) Wi-Fi/data OFF — cut the network, then reload from scratch.
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send('Page.navigate', { url: `${BASE}/` });
  if (!(await waitFor(`document.querySelector('#root')?.children.length > 0`, 20000, 'app mount OFFLINE'))) throw new Error('app did not mount offline');
  const online = await evalJs(`navigator.onLine`);
  console.log('navigator.onLine while "offline":', online);
  if (online !== false) fail('navigator.onLine is not false in offline mode');
  else ok('app OPENS with the network off (served from service-worker cache)');

  mkdirSync(resolve(root, 'screenshots'), { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(resolve(root, 'screenshots/offline-app-open.png'), Buffer.from(shot.data, 'base64'));

  // 5) OCR while offline — same flow as test-ocr.mjs, must read the photo.
  const photo = resolve(root, 'scripts/ocr-test/photo-clean.png');
  const gt = (await import('node:fs')).readFileSync(resolve(root, 'scripts/ocr-test/ground-truth.txt'), 'utf8');
  const truthWords = [...new Set(gt.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean))];
  await send('Page.navigate', { url: `${BASE}/` });
  await waitFor(`document.querySelector('#root')?.children.length > 0`, 20000, 'app mount OFFLINE (2nd)');
  const doc = await send('DOM.getDocument', { depth: -1 });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[accept="image/*"]' });
  if (!input.nodeId) throw new Error('photo input not found offline');
  await send('DOM.setFileInputFiles', { files: [photo], nodeId: input.nodeId });
  const t0 = Date.now();
  if (!(await waitFor(`document.querySelector('.ocr-result')?.textContent.includes('Scanned from photo')`, 120000, 'OCR result OFFLINE'))) throw new Error('OCR did not finish offline');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const line = await evalJs(`document.querySelector('.ocr-result')?.textContent`);
  const text = await evalJs(`document.querySelector('textarea')?.value ?? ''`);
  const got = new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  const recall = truthWords.filter((w) => got.has(w)).length / truthWords.length;
  console.log(`offline OCR: ${secs}s | recall ${(recall * 100).toFixed(1)}% | ${line}`);
  if (recall < 0.9) fail(`offline OCR recall ${(recall * 100).toFixed(1)}% < 90%`);
  else ok(`OCR works OFFLINE — ${secs}s, recall ${(recall * 100).toFixed(1)}%`);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(root, 'screenshots/offline-ocr.png'), Buffer.from(shot2.data, 'base64'));

  console.log(failures === 0 ? '\nOFFLINE TEST PASSED' : `\nOFFLINE TEST FAILED (${failures} failure(s))`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
}
