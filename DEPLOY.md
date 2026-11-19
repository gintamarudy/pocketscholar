# PocketScholar — Deploy guide (Firebase Hosting, free Spark plan)

Nothing here costs money. The Firebase project **pocketscholar-198d8**
(Spark plan) exists and the app is deployed at
https://pocketscholar-198d8.web.app. This file is the checklist to
(re)deploy it — run the steps below the moment anything changes.

## 0. Prerequisites

- A Firebase project on the **Spark plan** (no billing, no card).
  Create it at https://console.firebase.google.com/ (account:
  gintamarudy@gmail.com — the project identity).
- In the console, run **AI Services → AI Logic → Get started** and choose
  the **Gemini Developer API** as the provider (free tier). This setup
  enforces App Check — see step 3.
- Node 20+ and the Firebase CLI (no global install needed — `npx` below
  fetches it on demand).

## 1. Fill in the web config (`.env`)

1. In the console: **Project settings → Your apps → Web app** → copy the
   `firebaseConfig` object (or register a new Web app if there is none).
2. Copy `.env.example` to `.env` and paste the six values:

   ```bash
   cp .env.example .env
   ```

   ```ini
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=....firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=....appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=1:...:web:...
   ```

   These are public client config, not secrets — but they still live only
   in `.env` (git-ignored), never committed. `.env.example` stays empty.
3. Restart the dev server (`npm run dev`) and confirm the header pill
   changes from "Firebase not configured" to "Firebase connected".
   Generate a study pack on a sample note: the badge should now read
   **Cloud (Gemini)** (or **On-device (Gemini Nano)** on Chrome desktop
   with the model downloaded — see SETUP.md §4).

## 2. App Check — debug token (local dev) + reCAPTCHA (production)

The AI Logic guided setup enforces App Check. Without a valid token,
cloud inference fails.

**Local dev:**

1. Run the app, open DevTools → Console, copy the debug token from:
   `AppCheck debug token: "123a4567-...". You will need to safelist it...`
2. Console → **Security → App Check → Apps** → your web app → ⋮ →
   **Manage debug tokens** → add the token. Reload — cloud inference
   now works from localhost.

**Production (the deployed site):**

1. Console → **Security → App Check** → register a **reCAPTCHA Enterprise**
   site for your Hosting domain (`pocketscholar-198d8.web.app`) and copy the site key.
2. Add it to `.env` (production builds use the reCAPTCHA Enterprise provider):

   ```ini
   VITE_RECAPTCHA_SITE_KEY=...
   ```

   Note: `.env` values are baked in at **build** time — set the key
   *before* running `npm run build` for deploy.

## 3. Deploy

```bash
npm run build                  # must pass with no chunk-size warning
npx firebase login             # sign in as gintamarudy@gmail.com
npx firebase use --add         # pick the project; this creates .firebaserc (project id only, not a secret — commit it)
npx firebase deploy --only hosting,firestore:rules
```

What gets deployed:

- **Hosting** (`firebase.json`): serves `dist/` as a single-page app
  (all routes rewrite to `/index.html`); hashed `/assets/**` files get
  `Cache-Control: public, max-age=31536000, immutable`.
- **Firestore rules** (`firestore.rules`): notes sync only under
  `/devices/{deviceId}/notes/{noteId}` with **no auth** (single-device
  demo scoping — each browser only touches its own device id); every
  other path is denied. Before any public launch, replace this with
  Firebase Auth + per-user rules.

Verify after deploy:

1. Open `https://pocketscholar-198d8.web.app` — the app loads, welcome screen shows.
2. Load a sample note → **Generate study pack** → badge reads
   **Cloud (Gemini)** with a latency; open a second browser/device and
   confirm the note appears there after a reload (Firestore sync).
3. Open the same URL with DevTools → Network → **Offline** throttling:
   the app still loads from cache on revisit and Generate still works
   for short notes if Gemini Nano is available (otherwise it reports
   the cloud error honestly — there is no fake offline AI).

## 4. Demo deep links

The deployed app accepts `?sample=<id>` to open a sample note directly
(useful for the demo video and for judges):

- `https://pocketscholar-198d8.web.app/?sample=photosynthesis`
- `https://pocketscholar-198d8.web.app/?sample=newtons-laws`
- `https://pocketscholar-198d8.web.app/?sample=french-revolution`

## 5. Rollback / redeploy

Hosting keeps every release: `npx firebase hosting:releases:list` and
`npx firebase hosting:clone <source-site>:<release> <target-site>:live`
to roll back. A normal redeploy is just `npm run build` +
`npx firebase deploy --only hosting` again.

## What is verified (19 Nov 2026)

- Cloud inference end-to-end — **PASS** (retest ×2, badge reads
  **Cloud (Gemini)** with `inferenceSource` from the live SDK).
- Firestore sync end-to-end + App Check debug flow — **PASS**
  (push + pull across two browser profiles).
- Real on-device Nano generation — **PASS** (M3, 19 Nov 2026; short
  sample note, badge **On-device (Gemini Nano)**, 86.5 s latency on
  the test machine — see README for the honest latency note).
