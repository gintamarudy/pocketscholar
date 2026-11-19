# PocketScholar — Setup guide

Everything here is **free**: Firebase Spark plan, no credit card, no paid service.

## 1. Run locally (no Firebase needed)

```bash
npm install
npm run dev
```

Open http://localhost:5173. The app works fully offline-first. Until Firebase is
configured, **Generate** uses the local extractive fallback and says so in the UI.

## 2. Create the Firebase project (one-time, free)

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a
   project (Spark plan — do **not** add billing).
2. In the console go to **AI Services → AI Logic → Get started** and follow the
   guided setup. When asked for a Gemini API provider, choose the
   **Gemini Developer API** (free tier, no billing).
3. Register a **Web app** in Project settings and copy its `firebaseConfig`.
4. Copy `.env.example` to `.env` and fill in the six `VITE_FIREBASE_*` values.
5. Restart `npm run dev`.

The guided AI Logic setup **enforces App Check** for AI Logic. That is expected —
step 3 below covers local development.

## 3. App Check — debug token for local development

In dev builds the app sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` before
initializing App Check (see `src/lib/firebase.ts`). On first load:

1. Open the app at http://localhost:5173 and open DevTools → Console.
2. Copy the token from the line:
   `AppCheck debug token: "123a4567-b89c-12d3-e456-789012345678". You will need to safelist it in the Firebase console for it to work.`
3. In the Firebase console go to **Security → App Check → Apps**, find your web
   app, open the overflow menu (⋮) → **Manage debug tokens** → add the token.
4. Reload the app. Cloud inference now works from localhost.

For the deployed site, set `VITE_RECAPTCHA_SITE_KEY` in `.env` (production builds
use the reCAPTCHA v3 provider) and register the site in the console.

Reference: https://firebase.google.com/docs/app-check/web/debug-provider

## 4. On-device Gemini Nano (Chrome desktop)

On-device inference needs **Chrome 139+ on desktop**:

1. Enable the flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`
   and restart Chrome.
2. In DevTools console run:
   ```js
   await LanguageModel.availability();
   ```
   It should print `available`, `downloading`, or `downloadable`.
3. If it prints `downloadable`, start the one-time model download (≈4 GB) with:
   ```js
   await LanguageModel.create();
   ```
   After the download finishes, `availability()` returns `available` and short
   notes run fully on-device — no network needed.

PocketScholar checks `LanguageModel.availability()` on load and shows the Nano
status in the header. It calls `model.initializeDeviceModel()` after the
Generate click (Chrome requires a user gesture) and shows download progress.

Reference: https://firebase.google.com/docs/ai-logic/hybrid/web/get-started

## 5. Deploy to Firebase Hosting (free)

```bash
npm run build
npx firebase login
npx firebase use --add        # pick your project
npx firebase deploy --only hosting,firestore:rules
```

`firebase.json` and `firestore.rules` are included. The deployed app serves the
`dist/` build as a single-page app.

## What is verified (19 Nov 2026)

- **Cloud inference end-to-end** — PASS (retest ×2; badge reads
  **Cloud (Gemini)**).
- **Real on-device Nano generation** — PASS (M3; badge
  **On-device (Gemini Nano)**, 86.5 s on the test machine).
- **Firestore sync end-to-end** — PASS (push + pull across two
  browser profiles).
