// On-device photo OCR for PocketScholar (Tesseract.js v6, self-hosted).
//
// The photo NEVER leaves the device on this path: the worker script, the
// WASM core and the language data are all served from our own origin
// (public/tesseract/ — see its README.md), and the traineddata is cached in
// IndexedDB after the first scan, so later scans work offline too.
// Languages: English + Indonesian ('eng+ind'), so mixed study notes read
// in one pass.
//
// The cloud path (Gemini vision, better accuracy on handwriting and messy
// photos) lives in lib/ai.ts and is ONLY used when the user explicitly taps
// "Retry with cloud" — it sends the image to Google and the UI labels it
// as such. OCR only ever fills the note textarea; it never changes the
// Generate flow, the >=50-character gate, the hybrid badge, or sync.

import { createWorker, OEM, type Worker } from 'tesseract.js';

/** Base path of the vendored Tesseract assets (served from our origin). */
const TESS_BASE = '/tesseract';
/** Longest side of a photo before it is downscaled (phone photos are 12 MP+; Tesseract is slower and no more accurate on huge images). */
const MAX_PHOTO_SIDE = 2000;

export interface OcrProgress {
  phase: 'loading-engine' | 'loading-language' | 'recognizing';
  /** 0..1 progress within the current phase. */
  progress: number;
  /** Raw status string from the worker (for debugging). */
  status: string;
}

export interface OcrResult {
  /** Cleaned-up recognised text (trimmed, blank lines collapsed). */
  text: string;
  /** Mean word confidence reported by Tesseract, 0..100. */
  confidence: number;
  /** Number of recognised words. */
  words: number;
}

export interface PreparedPhoto {
  /** Downscaled (or original) image, ready for OCR or cloud vision. */
  blob: Blob;
  /** Object URL for the <img> preview. Revoke with URL.revokeObjectURL when done. */
  previewUrl: string;
  width: number;
  height: number;
}

let workerPromise: Promise<Worker> | null = null;

/** Map the worker's logger statuses onto our three UI phases. */
function mapLogger(
  m: { status: string; progress: number },
  onProgress?: (p: OcrProgress) => void,
): void {
  if (!onProgress) return;
  const { status, progress } = m;
  if (status === 'recognizing text') {
    onProgress({ phase: 'recognizing', progress, status });
  } else if (status === 'loading language traineddata' || status === 'initializing api') {
    onProgress({ phase: 'loading-language', progress, status });
  } else {
    onProgress({ phase: 'loading-engine', progress, status });
  }
}

/**
 * Lazily create (and keep) one worker for the session. The first call
 * downloads the engine + language data (~3 MB) and caches the traineddata
 * in IndexedDB; later calls reuse the warm worker with no download.
 */
async function getWorker(onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng+ind', OEM.LSTM_ONLY, {
      workerPath: `${TESS_BASE}/worker.min.js`,
      corePath: TESS_BASE,
      langPath: `${TESS_BASE}/lang`,
      gzip: true,
      // Default cacheMethod ('write') stores the traineddata in IndexedDB
      // after the first download, so repeat scans work offline.
      logger: (m) => mapLogger(m, onProgress),
    });
  }
  return workerPromise;
}

/**
 * Downscale a photo to at most MAX_PHOTO_SIDE on its longest side (keeps
 * EXIF orientation), returning a JPEG blob + preview URL. Photos already
 * small enough are returned untouched.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(width, height));
  if (scale === 1) {
    bitmap.close();
    return {
      blob: file,
      previewUrl: URL.createObjectURL(file),
      width,
      height,
    };
  }
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))),
      'image/jpeg',
      0.85,
    ),
  );
  return { blob, previewUrl: URL.createObjectURL(blob), width: w, height: h };
}

/** Light cleanup: trim, collapse 3+ blank lines, drop empty lines at the edges. */
function cleanOcrText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim();
}

/**
 * Recognise text in a prepared photo, fully on-device. Throws when the
 * image contains no readable text.
 */
export async function recognizePhoto(
  photo: Blob,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(photo);
  const text = cleanOcrText(data.text ?? '');
  if (!text) {
    throw new Error('No readable text found in this photo. Try a clearer, well-lit shot of printed text.');
  }
  return {
    text,
    confidence: Math.round(data.confidence ?? 0),
    words: text.split(/\s+/).length,
  };
}
