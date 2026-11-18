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

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readConfig(): FirebaseConfig | null {
  const cfg: FirebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
  };
  // All six fields are required for a usable config; a partial config is
  // treated as "not configured" so the app never half-initializes Firebase.
  const complete = Object.values(cfg).every((v) => typeof v === 'string' && v.length > 0);
  return complete ? cfg : null;
}

/** True when a complete Firebase web config is present in the environment. */
export function isFirebaseConfigured(): boolean {
  return readConfig() !== null;
}

let app: FirebaseApp | null = null;
let ai: AI | null = null;
let firestore: Firestore | null = null;
let appCheckReady = false;

/** Lazily initialize the Firebase app. Returns null when not configured. */
export function getFirebaseApp(): FirebaseApp | null {
  if (app) return app;
  const cfg = readConfig();
  if (!cfg) return null;
  app = initializeApp(cfg);

  // AppCheck: in dev, use the debug provider so localhost works while
  // enforcement is on. Setting FIREBASE_APPCHECK_DEBUG_TOKEN=true makes the
  // SDK print a debug token in the console; register it in the Firebase
  // console under App Check > Apps > Manage debug tokens (see SETUP.md).
  // In production builds the reCAPTCHA v3 provider is used instead — set
  // VITE_RECAPTCHA_SITE_KEY in .env for the deployed site.
  if (import.meta.env.DEV) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    initializeAppCheck(app, { isTokenAutoRefreshEnabled: true });
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
export function getAIClient(): AI | null {
  if (ai) return ai;
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return ai;
}

/** Firestore client for note sync. Returns null when Firebase is not configured. */
export function getFirestoreClient(): Firestore | null {
  if (firestore) return firestore;
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  firestore = getFirestore(firebaseApp);
  return firestore;
}
