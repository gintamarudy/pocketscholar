// Firebase web config — env-only, NO Firebase SDK imports.
//
// This module is intentionally tiny and statically importable anywhere
// (including the initial bundle): reading the config never pulls in the
// Firebase SDK. The SDK itself is loaded lazily in lib/firebase.ts so the
// first paint stays light; see the code-splitting note in vite.config.ts.

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

/** The raw config, or null when incomplete. Used only by lib/firebase.ts. */
export function getFirebaseConfig(): FirebaseConfig | null {
  return readConfig();
}
