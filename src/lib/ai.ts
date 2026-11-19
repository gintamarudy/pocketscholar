// Hybrid AI layer for PocketScholar.
//
// Routing (explicit, and always reported honestly in the UI):
//   1. No Firebase config yet            -> local extractive fallback
//      (clearly labelled "Local fallback", never presented as a model).
//   2. Chrome on-device model available
//      AND note is short                  -> Firebase AI Logic hybrid model
//      (InferenceMode.PREFER_ON_DEVICE). The SDK runs Gemini Nano on-device
//      and falls back to cloud itself if Nano fails mid-request.
//   3. Nano unavailable / note too long  -> cloud-only Gemini model via
//      Firebase AI Logic (Gemini Developer API backend, free tier).
//
// The source shown in the UI is read from `response.inferenceSource`
// (ON_DEVICE / IN_CLOUD) returned by the Firebase AI Logic SDK — never
// guessed from the route we asked for.
//
// References (researched 18 Nov 2026):
// - https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
// - firebase@13.4.0 / @firebase/ai — getAI, GoogleAIBackend,
//   getGenerativeModel, InferenceMode, InferenceSource, Schema.
// - Chrome Prompt API: LanguageModel.availability() ->
//   "available" | "downloadable" | "downloading" | "unavailable".

import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema,
  type GenerativeModel,
} from 'firebase/ai';
import { getAIClient } from './firebase';
import { isFirebaseConfigured } from './firebase-config';
import { checkNanoAvailability, ON_DEVICE_CHAR_LIMIT } from './nano';
import type {
  Flashcard,
  HybridStatus,
  QuizQuestion,
  StudyPack,
  StudyPackResult,
} from './types';

/** Cloud fallback model (also the SDK 13.x default hybrid in-cloud model). */
export const CLOUD_MODEL = 'gemini-3.5-flash-lite';
/** Hard cap sent to the cloud model so giant pastes stay within limits. */
const CLOUD_CHAR_LIMIT = 120_000;

export async function getHybridStatus(): Promise<HybridStatus> {
  return {
    nano: await checkNanoAvailability(),
    firebaseConfigured: isFirebaseConfigured(),
    online: navigator.onLine,
  };
}

// ---------------------------------------------------------------------------
// Structured output schema (shared by on-device responseConstraint and the
// cloud JSON mode). The model must return exactly this shape.
// ---------------------------------------------------------------------------

const studyPackSchema = Schema.object({
  properties: {
    summary: Schema.string({
      description: 'A concise summary of the note in 2-4 sentences.',
    }),
    keyPoints: Schema.array({
      items: Schema.string({ description: 'One key point from the note.' }),
      minItems: 3,
      maxItems: 8,
    }),
    flashcards: Schema.array({
      items: Schema.object({
        properties: {
          question: Schema.string(),
          answer: Schema.string(),
        },
      }),
      minItems: 3,
      maxItems: 8,
    }),
    quiz: Schema.array({
      items: Schema.object({
        properties: {
          question: Schema.string(),
          options: Schema.array({ items: Schema.string(), minItems: 4, maxItems: 4 }),
          answerIndex: Schema.integer(),
        },
      }),
      minItems: 3,
      maxItems: 5,
    }),
  },
});

/** Schema serialized to a plain JSON-Schema object for the on-device prompt API. */
function studyPackJsonSchema(): object {
  const withToJson = studyPackSchema as unknown as { toJSON?: () => object };
  if (typeof withToJson.toJSON === 'function') return withToJson.toJSON();
  // Fallback: hand-written equivalent of the schema above.
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      keyPoints: { type: 'array', items: { type: 'string' } },
      flashcards: {
        type: 'array',
        items: {
          type: 'object',
          properties: { question: { type: 'string' }, answer: { type: 'string' } },
        },
      },
      quiz: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answerIndex: { type: 'integer' },
          },
        },
      },
    },
    required: ['summary', 'keyPoints', 'flashcards', 'quiz'],
  };
}

function buildPrompt(noteText: string): string {
  return [
    'You are a study assistant. Based ONLY on the study note below, produce a study pack as a single JSON object with exactly these fields:',
    '- "summary": a concise summary in 2-4 sentences.',
    '- "keyPoints": an array of 5-8 short key points.',
    '- "flashcards": an array of 5-8 objects {"question", "answer"} for memorization.',
    '- "quiz": an array of 5 multiple-choice questions, each {"question", "options": [exactly 4 distinct options], "answerIndex": 0-3}.',
    'Write everything in English. Do not add facts that are not in the note. Return ONLY the JSON object, no markdown fences, no extra text.',
    '',
    '--- STUDY NOTE ---',
    noteText,
    '--- END NOTE ---',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Robust JSON parsing + validation of the model's answer
// ---------------------------------------------------------------------------

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function parseStudyPack(rawText: string): StudyPack {
  const text = rawText.trim();
  // The model is told to return bare JSON, but be tolerant of fences.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response was not valid JSON.');
  }
  const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response was not a JSON object.');
  }
  const obj = parsed as Record<string, unknown>;

  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  const keyPoints = asStringArray(obj.keyPoints).slice(0, 8);
  const flashcards: Flashcard[] = Array.isArray(obj.flashcards)
    ? obj.flashcards
        .filter(
          (f): f is { question: string; answer: string } =>
            !!f &&
            typeof f === 'object' &&
            typeof (f as { question?: unknown }).question === 'string' &&
            typeof (f as { answer?: unknown }).answer === 'string',
        )
        .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
        .filter((f) => f.question && f.answer)
        .slice(0, 8)
    : [];
  const quiz: QuizQuestion[] = Array.isArray(obj.quiz)
    ? obj.quiz
        .map((q) => {
          if (!q || typeof q !== 'object') return null;
          const r = q as Record<string, unknown>;
          const options = asStringArray(r.options).slice(0, 4);
          const answerIndex = typeof r.answerIndex === 'number' ? r.answerIndex : -1;
          if (
            typeof r.question !== 'string' ||
            !r.question.trim() ||
            options.length !== 4 ||
            answerIndex < 0 ||
            answerIndex > 3
          ) {
            return null;
          }
          return { question: r.question.trim(), options, answerIndex };
        })
        .filter((q): q is QuizQuestion => q !== null)
        .slice(0, 5)
    : [];

  if (!summary || keyPoints.length < 1 || flashcards.length < 1 || quiz.length < 1) {
    throw new Error('AI response was missing required study-pack fields.');
  }
  return { summary, keyPoints, flashcards, quiz };
}

// ---------------------------------------------------------------------------
// Local extractive fallback (used ONLY when Firebase is not configured).
// No model involved: sentences are ranked by keyword frequency. The UI
// labels this "Local fallback (extractive)" so it is never mistaken for AI.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  'a an the and or but of to in on for with is are was were be been it its this that these those as at by from not no do does did have has had will would can could should may might you we they he she his her their our your my i me'.split(
    ' ',
  ),
);

function splitSentences(text: string): string[] {
  // Drop bare heading lines ("Photosynthesis") so they don't merge into the
  // following sentence when whitespace is collapsed.
  const body = text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      const isHeading = !/[.!?]$/.test(t) && t.length < 80 && !t.includes('  ');
      return !isHeading;
    })
    .join(' ');
  return body
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && s.length < 400);
}

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

function extractiveStudyPack(noteText: string): StudyPack {
  const sentences = splitSentences(noteText);
  const freq = new Map<string, number>();
  for (const w of contentWords(noteText)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const score = (s: string) =>
    contentWords(s).reduce((sum, w) => sum + (freq.get(w) ?? 0), 0);
  const ranked = [...sentences].sort((a, b) => score(b) - score(a));
  const top = ranked.slice(0, 8);
  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  const summary = top.slice(0, 3).join(' ');
  const keyPoints = top.slice(0, 6).map((s) => (s.length > 140 ? `${s.slice(0, 137)}…` : s));

  // Cloze flashcards: blank out the most frequent keyword in a sentence.
  // Prefer a keyword that is not the first word, so the blank reads well.
  const pickKeyword = (s: string): string | undefined => {
    const words = contentWords(s).sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0));
    const firstWord = s.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9-]/g, '');
    return words.find((w) => w !== firstWord) ?? words[0];
  };
  const flashcards: Flashcard[] = [];
  for (const s of top.slice(0, 6)) {
    const key = pickKeyword(s);
    if (!key) continue;
    const blanked = s.replace(new RegExp(`\\b${key}\\b`, 'i'), '______');
    if (blanked === s) continue;
    flashcards.push({ question: `Fill in the blank: ${blanked}`, answer: key });
  }

  // Cloze quiz: same idea, distractors are other frequent keywords.
  const quiz: QuizQuestion[] = [];
  for (const s of top.slice(0, 5)) {
    const key = pickKeyword(s);
    if (!key) continue;
    const distractors = keywords.filter((w) => w !== key).slice(0, 3);
    if (distractors.length < 3) continue;
    const options = [...distractors, key].sort(() => Math.random() - 0.5);
    const blanked = s.replace(new RegExp(`\\b${key}\\b`, 'i'), '______');
    if (blanked === s) continue;
    quiz.push({
      question: `Which word completes this sentence? ${blanked}`,
      options,
      answerIndex: options.indexOf(key),
    });
  }

  if (!summary || flashcards.length === 0) {
    throw new Error(
      'Note is too short or too repetitive for the local fallback. Add more sentences and try again.',
    );
  }
  return { summary, keyPoints, flashcards, quiz };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface GenerateProgress {
  phase: 'checking' | 'downloading-model' | 'generating';
  /** 0..1 download progress while the on-device model downloads. */
  downloadProgress?: number;
  route?: string;
}

export interface GenerateOptions {
  onProgress?: (p: GenerateProgress) => void;
}

/**
 * Generate a study pack for a note, routing through real Firebase AI Logic
 * hybrid inference when Firebase is configured, and through the clearly
 * labelled local extractive fallback when it is not.
 */
export async function generateStudyPack(
  noteText: string,
  opts: GenerateOptions = {},
): Promise<StudyPackResult> {
  const startedAt = performance.now();
  const text = noteText.trim();
  if (text.length < 50) {
    throw new Error('Note is too short — write at least a few sentences first.');
  }

  // Route 1: no Firebase project configured yet -> honest local fallback.
  if (!isFirebaseConfigured()) {
    opts.onProgress?.({ phase: 'generating', route: 'local-fallback' });
    const pack = extractiveStudyPack(text);
    return {
      ...pack,
      source: 'local_fallback',
      modelName: 'Local fallback (extractive, no model)',
      latencyMs: Math.round(performance.now() - startedAt),
      routedReason:
        'Firebase is not configured yet, so no model was called. Add your Firebase web config to .env to enable Gemini (see SETUP.md).',
      generatedAt: Date.now(),
    };
  }

  const ai = await getAIClient();
  if (!ai) throw new Error('Firebase AI Logic is unavailable (no Firebase config).');

  opts.onProgress?.({ phase: 'checking' });
  const nano = await checkNanoAvailability();
  const shortEnough = text.length <= ON_DEVICE_CHAR_LIMIT;

  let model: GenerativeModel;
  let route: 'on-device' | 'cloud';
  let routedReason: string;

  if (nano === 'available' && shortEnough) {
    // Route 2: short note + Nano ready -> hybrid model, on-device preferred.
    route = 'on-device';
    routedReason = `Gemini Nano is available in this browser and the note is short (${text.length.toLocaleString()} chars ≤ ${ON_DEVICE_CHAR_LIMIT.toLocaleString()}), so the hybrid model runs on-device first.`;
    model = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: CLOUD_MODEL,
        generationConfig: { responseMimeType: 'application/json' },
      },
      onDeviceParams: {
        promptOptions: { responseConstraint: studyPackJsonSchema() },
      },
    });
    // MUST be called after a user gesture (the Generate click) and before
    // the first generateContent call. Triggers the ~model download on first
    // use and reports progress; resolves immediately when already downloaded.
    opts.onProgress?.({ phase: 'downloading-model', downloadProgress: 0 });
    await model.initializeDeviceModel((progress) => {
      opts.onProgress?.({ phase: 'downloading-model', downloadProgress: progress });
    });
  } else {
    // Route 3: Nano missing/downloading, or the note is too long for it.
    route = 'cloud';
    routedReason =
      nano === 'available'
        ? `Note is long (${text.length.toLocaleString()} chars > ${ON_DEVICE_CHAR_LIMIT.toLocaleString()}), so it goes to the cloud model instead of Gemini Nano.`
        : `Gemini Nano is ${nano} in this browser, so the request goes to the cloud model.`;
    model = getGenerativeModel(ai, {
      model: CLOUD_MODEL,
      generationConfig: { responseMimeType: 'application/json' },
    });
  }

  opts.onProgress?.({ phase: 'generating', route });
  const prompt = buildPrompt(
    route === 'cloud' && text.length > CLOUD_CHAR_LIMIT
      ? `${text.slice(0, CLOUD_CHAR_LIMIT)}\n\n[Note truncated to ${CLOUD_CHAR_LIMIT.toLocaleString()} characters for the cloud model.]`
      : text,
  );
  const result = await model.generateContent(prompt);
  const response = result.response;
  const raw = response.text();
  const pack = parseStudyPack(raw);

  // The SDK tells us where inference actually ran. Trust it, not the route.
  const reported = response.inferenceSource;
  const source =
    reported === InferenceSource.ON_DEVICE
      ? 'on_device'
      : reported === InferenceSource.IN_CLOUD
        ? 'in_cloud'
        : route === 'on-device'
          ? 'on_device'
          : 'in_cloud';
  const sourceNote =
    reported === undefined
      ? ' (SDK did not report inferenceSource; source inferred from the route taken.)'
      : '';

  return {
    ...pack,
    source,
    modelName:
      source === 'on_device'
        ? 'Gemini Nano (on-device)'
        : `Gemini ${CLOUD_MODEL} (cloud)`,
    latencyMs: Math.round(performance.now() - startedAt),
    routedReason: routedReason + sourceNote,
    generatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Cloud photo transcription (Gemini vision) — the OPTIONAL accuracy
// fallback for photo OCR. Only called when the user explicitly taps
// "Retry with cloud" after an on-device scan: unlike Tesseract, this sends
// the image to Google, and the UI says so. Same free-tier cloud model as
// generateStudyPack; the image should already be downscaled by
// lib/ocr.ts preparePhoto() before it gets here.
// ---------------------------------------------------------------------------

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  });
}

/**
 * Transcribe all text in a photo with the cloud Gemini model. Throws when
 * Firebase is not configured or when no text is found.
 */
export async function transcribePhotoCloud(image: Blob): Promise<string> {
  const ai = await getAIClient();
  if (!ai) {
    throw new Error('Firebase is not configured — cloud OCR needs the Firebase project.');
  }
  const model = getGenerativeModel(ai, { model: CLOUD_MODEL });
  const base64 = await blobToBase64(image);
  const result = await model.generateContent([
    {
      type: 'text',
      text: 'Transcribe ALL text visible in this photo exactly as written, preserving line breaks. Do not add commentary, explanations, or formatting beyond the text itself. If no text is visible, reply with an empty string.',
    },
    {
      type: 'inlineData',
      inlineData: { mimeType: image.type || 'image/jpeg', data: base64 },
    },
  ]);
  const text = result.response.text().trim();
  if (!text) {
    throw new Error('Cloud OCR found no text in this photo.');
  }
  return text;
}
