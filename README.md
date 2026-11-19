# PocketScholar

Offline-first AI study notes — built for **#BuildHybridAI 2026** (Firebase AI Logic), targeting **Best Web/Chrome App**.

**Live demo:** https://pocketscholar-198d8.web.app

Paste or type study notes (or import a `.txt` / `.md` file) and PocketScholar turns them into a **summary, key points, flashcards, and a multiple-choice quiz**. Notes are stored locally in IndexedDB and work fully offline; when Firebase is configured and you are online, they sync to Firestore.

## Why hybrid inference matters here

Students with unstable internet still need AI study help. PocketScholar routes every generation through **Firebase AI Logic hybrid inference** (`firebase/ai`):

| Situation | Route | Label shown in the UI |
|---|---|---|
| Gemini Nano available in Chrome (desktop) **and** the note is short (≤ 6,000 chars) | On-device via `InferenceMode.PREFER_ON_DEVICE` | **On-device (Gemini Nano)** |
| Nano unavailable, or the note is long | Cloud Gemini (`gemini-3.5-flash-lite`) via the Gemini Developer API backend | **Cloud (Gemini)** |
| No Firebase project configured yet | Local extractive fallback (no model called) | **Local fallback (extractive)** |

The label is read from the SDK's `response.inferenceSource` (`ON_DEVICE` / `IN_CLOUD`) — never guessed from the route requested. Every result also shows its latency and why that route was chosen.

> **Honest latency note:** on-device Nano is *not* fast on modest hardware — in our verification run (M3, 19 Nov 2026) a short sample note took **86.5 seconds** on-device, versus a few seconds in the cloud. On-device wins on privacy and offline use, not on speed.

## Tech

- **Vite + React + TypeScript**
- **Firebase AI Logic** (`firebase/ai` v13): `getAI` + `GoogleAIBackend`, `getGenerativeModel` with `InferenceMode.PREFER_ON_DEVICE`, `initializeDeviceModel()` (called after the Generate click, as Chrome requires), structured JSON output via `Schema` (on-device `responseConstraint` + cloud `responseMimeType: application/json`)
- **Firestore** for sync, **App Check** (debug provider in dev, reCAPTCHA v3 in prod)
- **IndexedDB** (hand-rolled, zero-dep) for offline-first notes + saved study packs

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build (outputs to dist/)
npm run preview    # serve the production build locally
```

No Firebase project is needed to run the app: without config it works fully local-only, with the clearly labelled extractive fallback. To enable real Gemini inference, follow [SETUP.md](SETUP.md).

## Configure your own Firebase project

```bash
cp .env.example .env   # then fill in the six VITE_FIREBASE_* values
```

Copy the values from your Firebase project: console → Project settings → Your apps → Web app → `firebaseConfig`. `.env` is git-ignored and never committed; `.env.example` lists only the key names, with no values. See [SETUP.md](SETUP.md) for the full guide (including the App Check debug token for local dev and reCAPTCHA v3 for production).

## Screenshots

Real-UI screenshots (headless Chromium via CDP — no `google-chrome` binary
on this VM, the Playwright-cached Chromium is used instead) live in
`screenshots/`:

| File | Shows |
|---|---|
| `01-welcome-desktop.png` | Welcome screen, desktop 1280×900 |
| `02-editor-sample-desktop.png` | Editor with the Photosynthesis sample |
| `03-study-summary-desktop.png` | Study pack — summary + key points + badge |
| `04-study-flashcards-desktop.png` | Flashcard mode |
| `05-study-quiz-desktop.png` | Quiz mode with feedback |
| `06-welcome-mobile.png` | Welcome screen, mobile 390×844 |
| `07-study-mobile.png` | Study pack, mobile 390×844 |
| `08-cloud-generate-desktop.png` | Cloud generation, desktop |
| `09-firestore-pull-desktop.png` | Firestore pull verification, desktop |
| `10-cloud-badge-desktop.png` | Cloud badge, desktop |

Regenerate them with the dev server + headless Chromium running (see
`scripts/screenshot.mjs` for the exact launch command):

```bash
npm run dev   # terminal 1
node scripts/screenshot.mjs   # terminal 2
```

## Project structure

```
src/
  lib/
    types.ts      # Note / StudyPack / inference-source types
    db.ts         # IndexedDB store (notes + study packs)
    firebase-config.ts  # env-only Firebase config (no SDK — safe to import anywhere)
    firebase.ts   # Firebase init, App Check, getAI / Firestore clients (SDK loaded lazily)
    nano.ts       # Chrome Prompt API probe + on-device char limit (no SDK)
    ai.ts         # Hybrid routing + providers (the AI Logic integration)
    samples.ts    # Demo sample notes (biology / physics / history)
    sync.ts       # Best-effort Firestore mirror
  components/
    StudyPanel.tsx  # Summary / flashcards / quiz + inference badge
  App.tsx         # Library, editor, import, status pills, setup panel
samples/          # Markdown seed files for the demo notes (generated from samples.ts)
```

## License

Apache-2.0 (see `LICENSE`).
