// Regenerate the Markdown seed files in `samples/` from src/lib/samples.ts
// (the single source of truth). Run: npm run export:samples
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_NOTES } from '../src/lib/samples.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'samples');
mkdirSync(outDir, { recursive: true });

for (const s of SAMPLE_NOTES) {
  const md = `# ${s.title.replace(/ — sample note$/, '')}\n\n_Subject: ${s.subject} · Sample note for PocketScholar demo_\n\n${s.content}\n`;
  writeFileSync(join(outDir, `${s.id}.md`), md);
  console.log(`wrote samples/${s.id}.md`);
}
console.log('Done. Keep samples.ts as the source of truth; re-run after edits.');
