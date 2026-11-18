// src/lib/ai.ts
import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema
} from "firebase/ai";

// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import "firebase/app-check";
import { getFirestore } from "firebase/firestore";
import { getAI, GoogleAIBackend } from "firebase/ai";
function readConfig() {
  const cfg = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  };
  const complete = Object.values(cfg).every((v) => typeof v === "string" && v.length > 0);
  return complete ? cfg : null;
}
function isFirebaseConfigured() {
  return readConfig() !== null;
}
var app = null;
var ai = null;
var appCheckReady = false;
function getFirebaseApp() {
  if (app) return app;
  const cfg = readConfig();
  if (!cfg) return null;
  app = initializeApp(cfg);
  if (false) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: () => Promise.resolve({ token: "debug", expireTimeMillis: Date.now() + 36e5 })
      }),
      isTokenAutoRefreshEnabled: true
    });
  } else if ("") {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(""),
      isTokenAutoRefreshEnabled: true
    });
  }
  appCheckReady = true;
  return app;
}
function getAIClient() {
  if (ai) return ai;
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return ai;
}

// src/lib/ai.ts
var CLOUD_MODEL = "gemini-3.5-flash-lite";
var ON_DEVICE_CHAR_LIMIT = 6e3;
var CLOUD_CHAR_LIMIT = 12e4;
function getLanguageModel() {
  const lm = window.LanguageModel;
  if (!lm || typeof lm.availability !== "function") return null;
  return lm;
}
async function checkNanoAvailability() {
  const lm = getLanguageModel();
  if (!lm) return "unsupported";
  try {
    const status = await lm.availability();
    if (status === "available" || status === "downloadable" || status === "downloading" || status === "unavailable") {
      return status;
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
var studyPackSchema = Schema.object({
  properties: {
    summary: Schema.string({
      description: "A concise summary of the note in 2-4 sentences."
    }),
    keyPoints: Schema.array({
      items: Schema.string({ description: "One key point from the note." }),
      minItems: 3,
      maxItems: 8
    }),
    flashcards: Schema.array({
      items: Schema.object({
        properties: {
          question: Schema.string(),
          answer: Schema.string()
        }
      }),
      minItems: 3,
      maxItems: 8
    }),
    quiz: Schema.array({
      items: Schema.object({
        properties: {
          question: Schema.string(),
          options: Schema.array({ items: Schema.string(), minItems: 4, maxItems: 4 }),
          answerIndex: Schema.integer()
        }
      }),
      minItems: 3,
      maxItems: 5
    })
  }
});
function studyPackJsonSchema() {
  const withToJson = studyPackSchema;
  if (typeof withToJson.toJSON === "function") return withToJson.toJSON();
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      keyPoints: { type: "array", items: { type: "string" } },
      flashcards: {
        type: "array",
        items: {
          type: "object",
          properties: { question: { type: "string" }, answer: { type: "string" } }
        }
      },
      quiz: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            answerIndex: { type: "integer" }
          }
        }
      }
    },
    required: ["summary", "keyPoints", "flashcards", "quiz"]
  };
}
function buildPrompt(noteText) {
  return [
    "You are a study assistant. Based ONLY on the study note below, produce a study pack as a single JSON object with exactly these fields:",
    '- "summary": a concise summary in 2-4 sentences.',
    '- "keyPoints": an array of 5-8 short key points.',
    '- "flashcards": an array of 5-8 objects {"question", "answer"} for memorization.',
    '- "quiz": an array of 5 multiple-choice questions, each {"question", "options": [exactly 4 distinct options], "answerIndex": 0-3}.',
    "Write everything in English. Do not add facts that are not in the note. Return ONLY the JSON object, no markdown fences, no extra text.",
    "",
    "--- STUDY NOTE ---",
    noteText,
    "--- END NOTE ---"
  ].join("\n");
}
function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim().length > 0);
}
function parseStudyPack(rawText) {
  const text = rawText.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI response was not valid JSON.");
  }
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response was not a JSON object.");
  }
  const obj = parsed;
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const keyPoints = asStringArray(obj.keyPoints).slice(0, 8);
  const flashcards = Array.isArray(obj.flashcards) ? obj.flashcards.filter(
    (f) => !!f && typeof f === "object" && typeof f.question === "string" && typeof f.answer === "string"
  ).map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })).filter((f) => f.question && f.answer).slice(0, 8) : [];
  const quiz = Array.isArray(obj.quiz) ? obj.quiz.map((q) => {
    if (!q || typeof q !== "object") return null;
    const r = q;
    const options = asStringArray(r.options).slice(0, 4);
    const answerIndex = typeof r.answerIndex === "number" ? r.answerIndex : -1;
    if (typeof r.question !== "string" || !r.question.trim() || options.length !== 4 || answerIndex < 0 || answerIndex > 3) {
      return null;
    }
    return { question: r.question.trim(), options, answerIndex };
  }).filter((q) => q !== null).slice(0, 5) : [];
  if (!summary || keyPoints.length < 1 || flashcards.length < 1 || quiz.length < 1) {
    throw new Error("AI response was missing required study-pack fields.");
  }
  return { summary, keyPoints, flashcards, quiz };
}
var STOPWORDS = new Set(
  "a an the and or but of to in on for with is are was were be been it its this that these those as at by from not no do does did have has had will would can could should may might you we they he she his her their our your my i me".split(
    " "
  )
);
function splitSentences(text) {
  const body = text.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return false;
    const isHeading = !/[.!?]$/.test(t) && t.length < 80 && !t.includes("  ");
    return !isHeading;
  }).join(" ");
  return body.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 25 && s.length < 400);
}
function contentWords(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w));
}
function extractiveStudyPack(noteText) {
  const sentences = splitSentences(noteText);
  const freq = /* @__PURE__ */ new Map();
  for (const w of contentWords(noteText)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const score = (s) => contentWords(s).reduce((sum, w) => sum + (freq.get(w) ?? 0), 0);
  const ranked = [...sentences].sort((a, b) => score(b) - score(a));
  const top = ranked.slice(0, 8);
  const keywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const summary = top.slice(0, 3).join(" ");
  const keyPoints = top.slice(0, 6).map((s) => s.length > 140 ? `${s.slice(0, 137)}\u2026` : s);
  const pickKeyword = (s) => {
    const words = contentWords(s).sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0));
    const firstWord = s.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9-]/g, "");
    return words.find((w) => w !== firstWord) ?? words[0];
  };
  const flashcards = [];
  for (const s of top.slice(0, 6)) {
    const key = pickKeyword(s);
    if (!key) continue;
    const blanked = s.replace(new RegExp(`\\b${key}\\b`, "i"), "______");
    if (blanked === s) continue;
    flashcards.push({ question: `Fill in the blank: ${blanked}`, answer: key });
  }
  const quiz = [];
  for (const s of top.slice(0, 5)) {
    const key = pickKeyword(s);
    if (!key) continue;
    const distractors = keywords.filter((w) => w !== key).slice(0, 3);
    if (distractors.length < 3) continue;
    const options = [...distractors, key].sort(() => Math.random() - 0.5);
    const blanked = s.replace(new RegExp(`\\b${key}\\b`, "i"), "______");
    if (blanked === s) continue;
    quiz.push({
      question: `Which word completes this sentence? ${blanked}`,
      options,
      answerIndex: options.indexOf(key)
    });
  }
  if (!summary || flashcards.length === 0) {
    throw new Error(
      "Note is too short or too repetitive for the local fallback. Add more sentences and try again."
    );
  }
  return { summary, keyPoints, flashcards, quiz };
}
async function generateStudyPack(noteText, opts = {}) {
  const startedAt = performance.now();
  const text = noteText.trim();
  if (text.length < 50) {
    throw new Error("Note is too short \u2014 write at least a few sentences first.");
  }
  if (!isFirebaseConfigured()) {
    opts.onProgress?.({ phase: "generating", route: "local-fallback" });
    const pack2 = extractiveStudyPack(text);
    return {
      ...pack2,
      source: "local_fallback",
      modelName: "Local fallback (extractive, no model)",
      latencyMs: Math.round(performance.now() - startedAt),
      routedReason: "Firebase is not configured yet, so no model was called. Add your Firebase web config to .env to enable Gemini (see SETUP.md).",
      generatedAt: Date.now()
    };
  }
  const ai2 = getAIClient();
  if (!ai2) throw new Error("Firebase AI Logic is unavailable (no Firebase config).");
  opts.onProgress?.({ phase: "checking" });
  const nano = await checkNanoAvailability();
  const shortEnough = text.length <= ON_DEVICE_CHAR_LIMIT;
  let model;
  let route;
  let routedReason;
  if (nano === "available" && shortEnough) {
    route = "on-device";
    routedReason = `Gemini Nano is available in this browser and the note is short (${text.length.toLocaleString()} chars \u2264 ${ON_DEVICE_CHAR_LIMIT.toLocaleString()}), so the hybrid model runs on-device first.`;
    model = getGenerativeModel(ai2, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: CLOUD_MODEL,
        generationConfig: { responseMimeType: "application/json" }
      },
      onDeviceParams: {
        promptOptions: { responseConstraint: studyPackJsonSchema() }
      }
    });
    opts.onProgress?.({ phase: "downloading-model", downloadProgress: 0 });
    await model.initializeDeviceModel((progress) => {
      opts.onProgress?.({ phase: "downloading-model", downloadProgress: progress });
    });
  } else {
    route = "cloud";
    routedReason = nano === "available" ? `Note is long (${text.length.toLocaleString()} chars > ${ON_DEVICE_CHAR_LIMIT.toLocaleString()}), so it goes to the cloud model instead of Gemini Nano.` : `Gemini Nano is ${nano} in this browser, so the request goes to the cloud model.`;
    model = getGenerativeModel(ai2, {
      model: CLOUD_MODEL,
      generationConfig: { responseMimeType: "application/json" }
    });
  }
  opts.onProgress?.({ phase: "generating", route });
  const prompt = buildPrompt(
    route === "cloud" && text.length > CLOUD_CHAR_LIMIT ? `${text.slice(0, CLOUD_CHAR_LIMIT)}

[Note truncated to ${CLOUD_CHAR_LIMIT.toLocaleString()} characters for the cloud model.]` : text
  );
  const result2 = await model.generateContent(prompt);
  const response = result2.response;
  const raw = response.text();
  const pack = parseStudyPack(raw);
  const reported = response.inferenceSource;
  const source = reported === InferenceSource.ON_DEVICE ? "on_device" : reported === InferenceSource.IN_CLOUD ? "in_cloud" : route === "on-device" ? "on_device" : "in_cloud";
  const sourceNote = reported === void 0 ? " (SDK did not report inferenceSource; source inferred from the route taken.)" : "";
  return {
    ...pack,
    source,
    modelName: source === "on_device" ? "Gemini Nano (on-device)" : `Gemini ${CLOUD_MODEL} (cloud)`,
    latencyMs: Math.round(performance.now() - startedAt),
    routedReason: routedReason + sourceNote,
    generatedAt: Date.now()
  };
}

// scripts/smoke-test-fallback.ts
globalThis.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
globalThis.self = globalThis;
globalThis.indexedDB = void 0;
var NOTE = `Photosynthesis

Photosynthesis is the process by which green plants, algae, and some bacteria convert light energy into chemical energy stored in glucose. It takes place mainly in the chloroplasts of leaf cells, using the pigment chlorophyll to capture sunlight.

The overall equation is: 6CO2 + 6H2O + light energy -> C6H12O6 + 6O2. Carbon dioxide enters through tiny pores called stomata, while water is absorbed by the roots and transported up through the xylem.

Photosynthesis has two stages. The light-dependent reactions take place in the thylakoid membranes and produce ATP and NADPH by splitting water, which releases oxygen as a byproduct. The Calvin cycle, or light-independent reactions, takes place in the stroma and uses ATP and NADPH to fix carbon dioxide into glucose.

Factors that affect the rate of photosynthesis include light intensity, carbon dioxide concentration, and temperature. If any one of these is too low, it becomes the limiting factor. Farmers use this knowledge in greenhouses by adding extra light and carbon dioxide to increase crop yields.`;
var result = await generateStudyPack(NOTE);
console.log("source:", result.source);
console.log("modelName:", result.modelName);
console.log("latencyMs:", result.latencyMs);
console.log("routedReason:", result.routedReason);
console.log("summary:", result.summary.slice(0, 200));
console.log("keyPoints:", result.keyPoints.length);
console.log("flashcards:", result.flashcards.length, JSON.stringify(result.flashcards[0]));
console.log("quiz:", result.quiz.length, JSON.stringify(result.quiz[0]));
var quizOk = result.quiz.every(
  (q) => q.options.length === 4 && q.answerIndex >= 0 && q.answerIndex <= 3
);
console.log("quiz shape OK:", quizOk);
if (result.source !== "local_fallback" || !quizOk || result.flashcards.length < 1) {
  throw new Error("SMOKE TEST FAILED");
}
console.log("SMOKE TEST PASSED");
