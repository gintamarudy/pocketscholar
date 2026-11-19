// Smoke test for the local extractive fallback (no Firebase configured).
// Stubs browser globals, then calls generateStudyPack() from src/lib/ai.ts
// and prints the resulting study pack + routing labels.
(globalThis as any).window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
(globalThis as any).self = globalThis;
(globalThis as any).indexedDB = undefined;

import { askQuestion, generateStudyPack } from '../src/lib/ai.ts';

const NOTE = `Photosynthesis

Photosynthesis is the process by which green plants, algae, and some bacteria convert light energy into chemical energy stored in glucose. It takes place mainly in the chloroplasts of leaf cells, using the pigment chlorophyll to capture sunlight.

The overall equation is: 6CO2 + 6H2O + light energy -> C6H12O6 + 6O2. Carbon dioxide enters through tiny pores called stomata, while water is absorbed by the roots and transported up through the xylem.

Photosynthesis has two stages. The light-dependent reactions take place in the thylakoid membranes and produce ATP and NADPH by splitting water, which releases oxygen as a byproduct. The Calvin cycle, or light-independent reactions, takes place in the stroma and uses ATP and NADPH to fix carbon dioxide into glucose.

Factors that affect the rate of photosynthesis include light intensity, carbon dioxide concentration, and temperature. If any one of these is too low, it becomes the limiting factor. Farmers use this knowledge in greenhouses by adding extra light and carbon dioxide to increase crop yields.`;

const result = await generateStudyPack(NOTE);
console.log('source:', result.source);
console.log('modelName:', result.modelName);
console.log('latencyMs:', result.latencyMs);
console.log('routedReason:', result.routedReason);
console.log('summary:', result.summary.slice(0, 200));
console.log('keyPoints:', result.keyPoints.length);
console.log('flashcards:', result.flashcards.length, JSON.stringify(result.flashcards[0]));
console.log('quiz:', result.quiz.length, JSON.stringify(result.quiz[0]));
const quizOk = result.quiz.every(
  (q) => q.options.length === 4 && q.answerIndex >= 0 && q.answerIndex <= 3,
);
console.log('quiz shape OK:', quizOk);
if (result.source !== 'local_fallback' || !quizOk || result.flashcards.length < 1) {
  throw new Error('SMOKE TEST FAILED');
}
console.log('SMOKE TEST PASSED');

// --- Q&A (same local extractive fallback, no Firebase configured) ---
// In-note question: the answer must quote the note's equation sentence.
const qaIn = await askQuestion(NOTE, 'What is the overall equation of photosynthesis?');
console.log('qa in-note:', qaIn.source, '|', qaIn.answer.slice(0, 200));
const qaInOk =
  qaIn.source === 'local_fallback' && /6CO2/.test(qaIn.answer) && /C6H12O6/.test(qaIn.answer);
console.log('qa in-note OK:', qaInOk);
// Out-of-note question: the answer must say plainly it is not in the note.
const qaOut = await askQuestion(NOTE, 'What is quantum computing?');
console.log('qa out-of-note:', qaOut.source, '|', qaOut.answer.slice(0, 200));
const qaOutOk = qaOut.source === 'local_fallback' && /doesn't seem to be in your note/i.test(qaOut.answer);
console.log('qa out-of-note OK:', qaOutOk);
if (!qaInOk || !qaOutOk) {
  throw new Error('Q&A SMOKE TEST FAILED');
}
console.log('Q&A SMOKE TEST PASSED');
