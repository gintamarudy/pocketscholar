// Runs scripts/smoke-test-fallback.ts in Node (no browser needed).
// Bundles it with esbuild, externalizing firebase/* (Firestore's grpc-js
// can't be bundled for Node ESM), then executes the bundle from the app
// directory so `firebase/*` resolves from node_modules. No Firebase config
// is needed: the test exercises the local extractive fallback path.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.smoke-test.mjs');

await build({
  entryPoints: [join(root, 'scripts', 'smoke-test-fallback.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  external: ['firebase', 'firebase/*', '@firebase/*'],
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_FIREBASE_API_KEY': '""',
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': '""',
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': '""',
    'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': '""',
    'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': '""',
    'import.meta.env.VITE_FIREBASE_APP_ID': '""',
    'import.meta.env.VITE_RECAPTCHA_SITE_KEY': '""',
  },
  logLevel: 'error',
});

try {
  const res = spawnSync('node', [out], { stdio: 'inherit', cwd: root });
  process.exit(res.status ?? 1);
} finally {
  rmSync(out, { force: true });
}
