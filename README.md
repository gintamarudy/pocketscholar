# PocketScholar

Offline-first AI study notes — built for **#BuildHybridAI 2026** (Firebase AI Logic), targeting **Best Web/Chrome App**.

Paste or type study notes (or import a `.txt` / `.md` file) and PocketScholar turns them into a **summary, key points, flashcards, and a multiple-choice quiz**. Notes are stored locally in IndexedDB and work fully offline; when Firebase is configured and you are online, they sync to Firestore.

## Why hybrid inference matters here

Students with unstable internet still need AI study help. PocketScholar routes every generation through **Firebase AI Logic hybrid inference** (`firebase/ai`):

| Situation | Route | Label shown in the UI |
|---|---|---|
| Gemini Nano available in Chrome (desktop) **and** the note is short (≤ 6,000 chars) | On-device via `InferenceMode.PREFER_ON_DEVICE` | **On-device (Gemini Nano)** |
| Nano unavailable, or the note is long | Cloud Gemini (`gemini-3.5-flash-lite`) via the Gemini Developer API backend | **Cloud (Gemini)** |
| No Firebase project configured yet | Local extractive fallback (no model called) | **Local fallback (extractive)** |

The label is read from the SDK's `response.inferenceSource` (`ON_DEVICE` / `IN_CLOUD`) — never guessed from the route requested. Every result also shows its latency and why that route was chosen.

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

## Project structure

```
src/
  lib/
    types.ts      # Note / StudyPack / inference-source types
    db.ts         # IndexedDB store (notes + study packs)
    firebase.ts   # Firebase init, App Check, getAI / Firestore clients
    ai.ts         # Hybrid routing + providers (the AI Logic integration)
    sync.ts       # Best-effort Firestore mirror
  components/
    StudyPanel.tsx  # Summary / flashcards / quiz + inference badge
  App.tsx         # Library, editor, import, status pills, setup panel
```

## License

Apache-2.0 (see `LICENSE`).
