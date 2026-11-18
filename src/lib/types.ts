// Shared types for PocketScholar.

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  /** Firestore sync state, maintained by the sync layer. */
  syncedAt?: number;
}

export interface Flashcard {
  question: string;
  answer: string;
}

export interface QuizQuestion {
  question: string;
  options: string[]; // exactly 4 options
  /** index into `options` of the correct answer */
  answerIndex: number;
}

export interface StudyPack {
  summary: string;
  keyPoints: string[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
}

/** Where the AI result actually ran. Never inferred — always read from the SDK. */
export type InferenceSourceKind = 'on_device' | 'in_cloud' | 'local_fallback';

export interface StudyPackResult extends StudyPack {
  source: InferenceSourceKind;
  /** Model label reported by the provider, e.g. "Gemini Nano (on-device)" */
  modelName: string;
  /** End-to-end latency of the generate call, in milliseconds. */
  latencyMs: number;
  /** Why this route was chosen (shown in the UI for transparency). */
  routedReason: string;
  generatedAt: number;
}

export interface StoredStudyPack extends StudyPackResult {
  noteId: string;
}

/** Result of probing Chrome's on-device model (Prompt API / LanguageModel). */
export type NanoAvailability =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable'
  | 'unsupported';

export interface HybridStatus {
  nano: NanoAvailability;
  /** True when a Firebase project config is present (env vars set). */
  firebaseConfigured: boolean;
  online: boolean;
}
