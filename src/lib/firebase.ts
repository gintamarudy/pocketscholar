// Firebase wiring for PocketScholar.
//
// NO secrets are hardcoded here. The web app's Firebase config is public
// client configuration (not an API secret), but this repo ships WITHOUT any
// real project values: fill them in via `.env` (see `.env.example`) after the
// Firebase project is created in the console. Until then the app runs fully
// local-only and every cloud feature degrades gracefully (see lib/ai.ts and
// lib/sync.ts).
//
// AppCheck: the AI Logic guided setup enforces App Check. For local dev we
// use the debug provider (see SETUP.md for how to register the debug token).
//
// Code-splitting: only `firebase/app` is imported statically. The heavy
// SDKs — `firebase/ai`, `firebase/firestore`, `firebase/app-check` — are
// loaded with dynamic import() on first use, so the initial bundle stays
// under Vite's 500 KB chunk warning. All three getters below are therefore
// async; callers (generateStudyPack, sync) already run in async contexts.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirebaseConfig } from './firebase-config';
import type { AI } from 'firebase/ai';
import type { Firestore } from 'firebase/firestore';

let app: FirebaseApp | null = null;
let ai: AI | null = null;
let firestore: Firestore | null = null;
let appCheckReady = false;

/** Lazily initialize the Firebase app. Returns null when not configured. */
export async function getFirebaseApp(): Promise<FirebaseApp | null> {
  if (app) return app;
  const cfg = getFirebaseConfig();
  if (!cfg) return null;
  app = initializeApp(cfg);

  // AppCheck: in dev, use the debug provider so localhost works while
  // enforcement is on. Setting FIREBASE_APPCHECK_DEBUG_TOKEN=true makes the
  // SDK print a debug token in the console and use it for every token
  // request (the provider passed here is then unused); register that token
  // in the Firebase console under App Check > Apps > Manage debug tokens
  // (see SETUP.md). In production builds the reCAPTCHA v3 provider is used
  // instead — set VITE_RECAPTCHA_SITE_KEY in .env for the deployed site.
  // (AppCheckOptions requires a provider, hence the CustomProvider
  // placeholder in dev; it is never called while debug mode is enabled.)
  const { initializeAppCheck, CustomProvider, ReCaptchaV3Provider } = await import(
    'firebase/app-check'
  );
  if (import.meta.env.DEV) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: () =>
          Promise.resolve({ token: 'debug', expireTimeMillis: Date.now() + 3_600_000 }),
      }),
      isTokenAutoRefreshEnabled: true,
    });
  } else if (import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }
  appCheckReady = true;
  return app;
}

export function isAppCheckReady(): boolean {
  return appCheckReady;
}

/**
 * The Firebase AI Logic client (Gemini Developer API backend — free tier,
 * no billing required). Returns null when Firebase is not configured.
 */
export async function getAIClient(): Promise<AI | null> {
  if (ai) return ai;
  const firebaseApp = await getFirebaseApp();
  if (!firebaseApp) return null;
  const { getAI, GoogleAIBackend } = await import('firebase/ai');
  ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return ai;
}

/** Firestore client for note sync. Returns null when Firebase is not configured. */
export async function getFirestoreClient(): Promise<Firestore | null> {
  if (firestore) return firestore;
  const firebaseApp = await getFirebaseApp();
  if (!firebaseApp) return null;
  const { getFirestore } = await import('firebase/firestore');
  firestore = getFirestore(firebaseApp);
  return firestore;
}
