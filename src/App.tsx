// PocketScholar — offline-first AI study notes.
// Library + editor (IndexedDB) on the left, AI study pack on the right.
// All UI text is in English.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteNote,
  deleteQaThread,
  getNote,
  getQaThread,
  getStudyPack,
  listNotes,
  newNoteId,
  saveNote,
  saveQaThread,
  saveStudyPack,
} from './lib/db';
import { checkNanoAvailability, ON_DEVICE_CHAR_LIMIT } from './lib/nano';
import type { GenerateProgress } from './lib/ai';
import { isFirebaseConfigured } from './lib/firebase-config';
import { describeSyncState, type NanoAvailability, type Note, type QaMessage, type StoredStudyPack, type SyncState } from './lib/types';
import { getSampleNote, SAMPLE_NOTES } from './lib/samples';
import { InferenceBadge } from './components/InferenceBadge';
import './App.css';

// Code-splitting: the study panel (and, through it, the Firebase AI Logic
// SDK in lib/ai.ts) loads on demand, so the first paint stays under Vite's
// 500 KB chunk warning. `generateStudyPack` is likewise imported
// dynamically inside onGenerate (see below).
const StudyPanel = lazy(() => import('./components/StudyPanel'));

function nanoLabel(nano: NanoAvailability): string {
  switch (nano) {
    case 'available':
      return 'Gemini Nano: available on-device';
    case 'downloadable':
      return 'Gemini Nano: downloadable (one click to download)';
    case 'downloading':
      return 'Gemini Nano: downloading…';
    case 'unavailable':
      return 'Gemini Nano: unavailable in this browser';
    case 'unsupported':
      return 'Gemini Nano: not supported (needs Chrome 139+ on desktop)';
  }
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pack, setPack] = useState<StoredStudyPack | null>(null);
  const [search, setSearch] = useState('');
  const [nano, setNano] = useState<NanoAvailability>('unsupported');
  const [firebaseConfigured] = useState(() => isFirebaseConfigured());
  const [syncState, setSyncState] = useState<SyncState>(
    isFirebaseConfigured() ? (navigator.onLine ? 'synced' : 'offline') : 'local-only',
  );
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sampleId, setSampleId] = useState(SAMPLE_NOTES[0].id);
  const deepLinkHandled = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  // Photo OCR (Tesseract on-device, or cloud Gemini on retry).
  const [ocrWorking, setOcrWorking] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ label: string; value: number } | null>(null);
  const [ocrInfo, setOcrInfo] = useState<{
    confidence: number | null;
    words: number;
    source: 'on-device' | 'cloud';
    fileName: string;
  } | null>(null);
  const [ocrPhoto, setOcrPhoto] = useState<{ blob: Blob; previewUrl: string } | null>(null);

  // Q&A about the selected note (photo -> note -> ask). History is per-note,
  // stored in IndexedDB like study packs, and loaded when a note opens.
  const [qaMessages, setQaMessages] = useState<QaMessage[]>([]);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAsking, setQaAsking] = useState(false);
  const [qaStatus, setQaStatus] = useState<string | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);

  const selected = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId],
  );

  const refreshNotes = useCallback(async () => {
    const local = await listNotes();
    setNotes(local);
    return local;
  }, []);

  // Initial load: local notes first, then a best-effort Firestore pull.
  useEffect(() => {
    refreshNotes().then(async (local) => {
      if (isFirebaseConfigured() && navigator.onLine) {
        const { pullNotes } = await import('./lib/sync');
        const merged = await pullNotes(local);
        if (merged.length !== local.length) {
          for (const n of merged) await saveNote(n);
          setNotes(merged);
        }
      }
      setLoaded(true);
    });
    checkNanoAvailability().then(setNano);
    const onOnline = () => {
      setSyncState(isFirebaseConfigured() ? 'syncing' : 'local-only');
      refreshNotes().then(async (local) => {
        if (!isFirebaseConfigured()) return;
        const { pullNotes } = await import('./lib/sync');
        const merged = await pullNotes(local);
        setNotes(merged);
        setSyncState('synced');
      });
    };
    const onOffline = () => setSyncState(isFirebaseConfigured() ? 'offline' : 'local-only');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refreshNotes]);

  const openNote = useCallback(async (id: string) => {
    const note = await getNote(id);
    if (!note) return;
    setSelectedId(id);
    setTitle(note.title);
    setContent(note.content);
    setPack((await getStudyPack(id)) ?? null);
    setQaMessages((await getQaThread(id))?.messages ?? []);
    setQaError(null);
    setError(null);
  }, []);

  // Autosave (debounced) — local first, Firestore push best-effort.
  useEffect(() => {
    if (!selectedId) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const note: Note = {
        id: selectedId,
        title: title.trim() || 'Untitled note',
        content,
        createdAt: selected?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      await saveNote(note);
      setNotes((prev) =>
        prev.map((n) => (n.id === note.id ? note : n)).sort((a, b) => b.updatedAt - a.updatedAt),
      );
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1200);
      if (isFirebaseConfigured()) {
        if (!navigator.onLine) {
          setSyncState('offline');
        } else {
          setSyncState('syncing');
          const { pushNote } = await import('./lib/sync');
          setSyncState((await pushNote(note)) ? 'synced' : 'error');
        }
      }
    }, 600);
    return () => window.clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, selectedId]);

  const createNote = useCallback(async (initialContent = '', initialTitle = '') => {
    const note: Note = {
      id: newNoteId(),
      title: initialTitle || 'Untitled note',
      content: initialContent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveNote(note);
    setNotes((prev) => [note, ...prev]);
    setSelectedId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setPack(null);
    setQaMessages([]);
    setQaError(null);
    setError(null);
  }, []);

  const loadSample = useCallback(
    (id: string) => {
      const sample = getSampleNote(id);
      if (!sample) return;
      void createNote(sample.content, sample.title);
    },
    [createNote],
  );

  // Deep link for demos: `?sample=photosynthesis` (or newtons-laws /
  // french-revolution) opens that sample note on first load, creating it
  // if it is not in the library yet.
  useEffect(() => {
    if (!loaded || deepLinkHandled.current) return;
    const sample = getSampleNote(
      new URLSearchParams(window.location.search).get('sample') ?? '',
    );
    if (!sample) return;
    deepLinkHandled.current = true;
    const existing = notes.find((n) => n.title === sample.title);
    if (existing) void openNote(existing.id);
    else void createNote(sample.content, sample.title);
  }, [loaded, notes, createNote, openNote]);

  const removeNote = useCallback(async () => {
    if (!selectedId) return;
    if (!window.confirm('Delete this note and its study pack?')) return;
    await deleteNote(selectedId);
    setSelectedId(null);
    setTitle('');
    setContent('');
    setPack(null);
    setNotes((prev) => prev.filter((n) => n.id !== selectedId));
  }, [selectedId]);

  const importFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const name = file.name.replace(/\.(txt|md)$/i, '').replace(/[-_]+/g, ' ');
      await createNote(text, name || file.name);
    },
    [createNote],
  );

  // Photo -> text (OCR). On-device first (Tesseract.js, English +
  // Indonesian); the photo never leaves the device on this path. The
  // recognised text lands in a NEW note's textarea so the user can correct
  // it before Generate — OCR misreads, especially handwriting.
  const scanPhoto = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('Please choose an image file (photo of a printed page).');
        return;
      }
      setError(null);
      setOcrInfo(null);
      setOcrWorking(true);
      setOcrProgress({ label: 'Preparing photo…', value: 0 });
      try {
        const { preparePhoto, recognizePhoto } = await import('./lib/ocr');
        const prepared = await preparePhoto(file);
        setOcrPhoto((prev) => {
          if (prev) URL.revokeObjectURL(prev.previewUrl);
          return { blob: prepared.blob, previewUrl: prepared.previewUrl };
        });
        const base = file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[-_]+/g, ' ')
          .trim();
        await createNote('', base ? `Scanned: ${base}` : 'Scanned photo');
        const result = await recognizePhoto(prepared.blob, (p) => {
          const label =
            p.phase === 'loading-engine'
              ? 'Loading OCR engine…'
              : p.phase === 'loading-language'
                ? 'Downloading OCR language data (first scan only)…'
                : 'Reading text from photo…';
          setOcrProgress({ label, value: p.progress });
        });
        setContent((prev) => (prev.trim() ? `${prev.trim()}\n\n${result.text}` : result.text));
        setOcrInfo({
          confidence: result.confidence,
          words: result.words,
          source: 'on-device',
          fileName: file.name,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Photo scan failed.');
      } finally {
        setOcrWorking(false);
        setOcrProgress(null);
      }
    },
    [createNote],
  );

  // Optional cloud re-read of the same photo with Gemini vision (better
  // accuracy on handwriting and messy photos). Sends the image to Google —
  // the button says so — and replaces the textarea text.
  const retryCloudOcr = useCallback(async () => {
    if (!ocrPhoto || ocrWorking) return;
    setError(null);
    setOcrWorking(true);
    setOcrProgress({ label: 'Reading photo with cloud Gemini…', value: 0.5 });
    try {
      const { transcribePhotoCloud } = await import('./lib/ai');
      const text = await transcribePhotoCloud(ocrPhoto.blob);
      setContent(text);
      setOcrInfo((prev) =>
        prev
          ? { ...prev, source: 'cloud', confidence: null, words: text.split(/\s+/).length }
          : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cloud OCR failed.');
    } finally {
      setOcrWorking(false);
      setOcrProgress(null);
    }
  }, [ocrPhoto, ocrWorking]);

  const onGenerate = useCallback(async () => {
    if (!selectedId || generating) return;
    setGenerating(true);
    setError(null);
    setProgress({ phase: 'checking' });
    try {
      // The AI module (and the Firebase AI Logic SDK it imports) loads on
      // demand here, keeping the initial bundle small. initializeDeviceModel()
      // is called inside generateStudyPack, still within this click
      // handler's user activation, as Chrome requires.
      const { generateStudyPack } = await import('./lib/ai');
      const result = await generateStudyPack(content, { onProgress: setProgress });
      const stored: StoredStudyPack = { ...result, noteId: selectedId };
      await saveStudyPack(stored);
      setPack(stored);
      // Re-probe Nano status: a first run may have triggered the download.
      checkNanoAvailability().then(setNano);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }, [selectedId, generating, content]);

  // Ask a question about the selected note. Same hybrid routing as Generate
  // (Nano on-device when available, cloud otherwise); the answer is grounded
  // in the note — see lib/ai.ts askQuestion. The AI module loads on demand.
  const askQa = useCallback(async () => {
    if (!selectedId || qaAsking) return;
    const question = qaQuestion.trim();
    if (!question) return;
    setQaAsking(true);
    setQaError(null);
    setQaStatus('Checking where to answer…');
    const userMsg: QaMessage = { role: 'user', text: question, askedAt: Date.now() };
    const withQuestion = [...qaMessages, userMsg];
    setQaMessages(withQuestion);
    setQaQuestion('');
    try {
      const { askQuestion } = await import('./lib/ai');
      const answer = await askQuestion(content, question, {
        history: qaMessages,
        onProgress: (p) => {
          setQaStatus(
            p.phase === 'checking'
              ? 'Checking where to answer…'
              : p.route === 'on-device'
                ? 'Answering on-device (Gemini Nano)…'
                : p.route === 'cloud'
                  ? 'Answering in the cloud (Gemini)…'
                  : 'Answering from your note (local)…',
          );
        },
      });
      const assistantMsg: QaMessage = {
        role: 'assistant',
        text: answer.answer,
        source: answer.source,
        modelName: answer.modelName,
        latencyMs: answer.latencyMs,
        askedAt: Date.now(),
      };
      const updated = [...withQuestion, assistantMsg];
      setQaMessages(updated);
      await saveQaThread({ noteId: selectedId, messages: updated, updatedAt: Date.now() });
      checkNanoAvailability().then(setNano);
    } catch (err) {
      setQaError(err instanceof Error ? err.message : 'Could not answer that question.');
    } finally {
      setQaAsking(false);
      setQaStatus(null);
    }
  }, [selectedId, qaAsking, qaQuestion, qaMessages, content]);

  const clearQa = useCallback(async () => {
    if (!selectedId) return;
    setQaMessages([]);
    setQaError(null);
    await deleteQaThread(selectedId);
  }, [selectedId]);

  const filtered = notes.filter(
    (n) =>
      n.title.toLowerCase().includes(search.toLowerCase()) ||
      n.content.toLowerCase().includes(search.toLowerCase()),
  );

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const willUseNano =
    nano === 'available' && content.length <= ON_DEVICE_CHAR_LIMIT && content.length >= 50;

  // Live elapsed timer while a generation runs (on-device can take 86 s+).
  // The route label uses the real route once ai.ts reports it, and the
  // pre-flight prediction while it is still checking/downloading.
  useEffect(() => {
    if (!generating) return;
    setElapsed(0);
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [generating]);

  const generatingRouteLabel =
    progress?.phase === 'generating'
      ? progress.route === 'on-device'
        ? 'On-device (Gemini Nano)'
        : progress.route === 'cloud'
          ? 'Cloud (Gemini)'
          : 'Local fallback'
      : willUseNano
        ? 'On-device (Gemini Nano)'
        : firebaseConfigured
          ? 'Cloud (Gemini)'
          : 'Local fallback';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">📚</span>
          <div>
            <h1>PocketScholar</h1>
            <p className="tagline">Offline-first AI study notes — on-device when possible, cloud when needed.</p>
          </div>
        </div>
        <div className="status-pills">
          <span className={`pill ${nano === 'available' ? 'pill-ok' : 'pill-warn'}`} title={nanoLabel(nano)}>
            {nano === 'available' ? '● Nano ready' : `○ Nano: ${nano}`}
          </span>
          <span className={`pill ${firebaseConfigured ? 'pill-ok' : 'pill-warn'}`} title={firebaseConfigured ? 'Firebase project configured — cloud inference available' : 'No Firebase config in .env — running local-only'}>
            {firebaseConfigured ? '● Firebase connected' : '○ Firebase not configured'}
          </span>
          <span className="pill" title={describeSyncState(syncState)}>
            {syncState === 'local-only' ? '💾 Local only' : describeSyncState(syncState)}
          </span>
          <button className="setup-btn" onClick={() => setShowSetup(!showSetup)}>
            {showSetup ? 'Hide setup' : 'Setup & how it works'}
          </button>
        </div>
      </header>

      {showSetup && (
        <section className="setup-panel">
          <h2>How PocketScholar works</h2>
          <ol>
            <li><strong>Write, import, or scan a note</strong> — type it, import a .txt / .md file, or <strong>scan a photo</strong> of a printed page (on-device OCR, English + Indonesian; works offline after the first scan). It is saved in your browser (IndexedDB) and works fully offline.</li>
            <li><strong>Generate a study pack</strong> — summary, key points, flashcards and a quiz. Routing is automatic and always labelled:
              <ul>
                <li><strong>On-device (Gemini Nano)</strong> — when Chrome on desktop has the model available and the note is short (≤ {ON_DEVICE_CHAR_LIMIT.toLocaleString()} characters). Your note never leaves the device.</li>
                <li><strong>Cloud (Gemini)</strong> — when Nano is unavailable or the note is long. Runs through Firebase AI Logic (Gemini Developer API, free tier).</li>
                <li><strong>Local fallback (extractive)</strong> — only while no Firebase project is configured yet. No model is called; the summary is built from your own sentences.</li>
              </ul>
            </li>
            <li><strong>Study</strong> with flip flashcards and an interactive quiz, then come back any time — packs are saved with the note.</li>
            <li><strong>Ask about the note</strong> — below the study pack, ask a question and get a grounded answer from the note (on-device or cloud, same routing as Generate, badge shown on every answer). History is saved on this device.</li>
            <li><strong>Sync:</strong> when Firebase is configured and you are online, notes mirror to Firestore automatically.</li>
            <li><strong>Install for offline use:</strong> this is an installable app — in your browser menu choose <em>Install PocketScholar</em> (or <em>Add to Home Screen</em> on a phone). After the first online visit the app opens offline, and photo OCR works without internet. Generate still needs the cloud (or Nano on desktop Chrome) — only the note, the study pack, the Q&amp;A history and the photo scanner work offline.</li>
          </ol>
          <h3>To enable the cloud path (one-time, free)</h3>
          <ol>
            <li>Create a free Firebase project (Spark plan, no card) in the Firebase console, run the AI Logic guided setup, and choose the <em>Gemini Developer API</em>.</li>
            <li>Copy <code>.env.example</code> to <code>.env</code> and fill in the six <code>VITE_FIREBASE_*</code> values from your web app config.</li>
            <li>App Check (enforced by the AI Logic setup): in dev, the app sets <code>FIREBASE_APPCHECK_DEBUG_TOKEN=true</code> and prints a debug token in the browser console — register it in the console under <em>App Check → Apps → Manage debug tokens</em>. Full steps: <code>SETUP.md</code>.</li>
            <li>On-device Nano (Chrome 139+ desktop): enable <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>, restart Chrome, then run <code>await LanguageModel.availability()</code> in DevTools — it should read <code>available</code> (first use downloads the model once).</li>
          </ol>
          {!firebaseConfigured && (
            <p className="setup-warn">⚠️ Firebase is not configured in this build, so Generate currently uses the local extractive fallback. The Firebase AI Logic code is real and wired — it activates as soon as <code>.env</code> is filled in.</p>
          )}
        </section>
      )}

      <main className="layout">
        <aside className="sidebar">
          <div className="sidebar-actions">
            <button className="primary" onClick={() => createNote()}>
              + New note
            </button>
            <button onClick={() => fileRef.current?.click()}>Import .txt/.md</button>
            <button onClick={() => photoRef.current?.click()}>📷 Scan photo</button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void scanPhoto(f);
                e.target.value = '';
              }}
            />
          </div>
          <input
            className="search"
            type="search"
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search notes"
          />
          <div className="sample-picker">
            <label htmlFor="sample-select">Try a sample note</label>
            <div className="sample-row">
              <select
                id="sample-select"
                value={sampleId}
                onChange={(e) => setSampleId(e.target.value)}
              >
                {SAMPLE_NOTES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.subject} — {s.title.replace(' — sample note', '')}
                  </option>
                ))}
              </select>
              <button onClick={() => loadSample(sampleId)}>Load sample</button>
            </div>
          </div>
          <ul className="note-list">
            {filtered.length === 0 && notes.length === 0 && (
              <li className="empty">
                No notes yet.{' '}
                <button className="link-btn" onClick={() => loadSample('photosynthesis')}>
                  Load the sample note
                </button>{' '}
                to try it out.
              </li>
            )}
            {filtered.length === 0 && notes.length > 0 && (
              <li className="empty">No notes match “{search}”.</li>
            )}
            {filtered.map((n) => (
              <li key={n.id}>
                <button
                  className={`note-item ${n.id === selectedId ? 'selected' : ''}`}
                  onClick={() => void openNote(n.id)}
                >
                  <span className="note-title">{n.title}</span>
                  <span className="note-snippet">{n.content.slice(0, 80) || 'Empty note'}</span>
                  <span className="note-date">
                    {new Date(n.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    · {new Date(n.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="sidebar-foot">
            Notes live in this browser (IndexedDB).
            {firebaseConfigured ? ' They also sync to Firestore when online.' : ' Add Firebase config to sync them to Firestore.'}
          </p>
        </aside>

        <section className="editor-pane">
          {selected ? (
            <>
              <input
                className="title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Note title"
                aria-label="Note title"
              />
              <textarea
                className="content-input"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste or type your study notes here… (or import a .txt / .md file)"
                aria-label="Note content"
              />
              <div className="editor-bar">
                <span className="meta">
                  {wordCount.toLocaleString()} words · {content.length.toLocaleString()} characters
                  {savedFlash ? ' · ✓ Saved locally' : ''}
                </span>
                <span className="route-preview" title={nanoLabel(nano)}>
                  {content.length < 50
                    ? 'Write a few sentences to enable Generate.'
                    : willUseNano
                      ? 'Will try: On-device (Gemini Nano)'
                      : firebaseConfigured
                        ? 'Will try: Cloud (Gemini)'
                        : 'Will use: Local fallback (Firebase not configured)'}
                </span>
                <button className="danger-ghost" onClick={() => void removeNote()}>
                  Delete
                </button>
                <button
                  className="primary"
                  disabled={generating || content.trim().length < 50}
                  onClick={() => void onGenerate()}
                >
                  {generating ? 'Generating…' : '✨ Generate study pack'}
                </button>
              </div>
              {ocrProgress && (
                <div className="ocr-bar" role="status">
                  <span>
                    {ocrProgress.label} {Math.round(ocrProgress.value * 100)}%
                  </span>
                  <progress value={ocrProgress.value} max={1} />
                </div>
              )}
              {ocrPhoto && !ocrWorking && (
                <img className="ocr-preview" src={ocrPhoto.previewUrl} alt="Scanned photo" />
              )}
              {ocrInfo && !ocrWorking && (
                <p className="ocr-result" role="status">
                  <span>
                    Scanned from photo “{ocrInfo.fileName}” ·{' '}
                    {ocrInfo.source === 'on-device'
                      ? `On-device OCR (Tesseract, English + Indonesian)${
                          ocrInfo.confidence !== null ? ` · confidence ${ocrInfo.confidence}%` : ''
                        }`
                      : 'Cloud OCR (Gemini vision)'}{' '}
                    · {ocrInfo.words.toLocaleString()} words — check the text above, then Generate.
                  </span>
                  {ocrInfo.source === 'on-device' && firebaseConfigured && navigator.onLine && (
                    <button
                      className="link-btn"
                      onClick={() => void retryCloudOcr()}
                      title="Sends the photo to Gemini in the cloud — better accuracy on handwriting and messy photos, but the image leaves your device."
                    >
                      Retry with cloud (Gemini)
                    </button>
                  )}
                </p>
              )}
              {progress?.phase === 'downloading-model' && (
                <div className="download-bar" role="status">
                  <span>Downloading on-device model… {Math.round((progress.downloadProgress ?? 0) * 100)}%</span>
                  <progress value={progress.downloadProgress ?? 0} max={1} />
                </div>
              )}
              {generating && (
                <p className="generating-status" role="status">
                  Generating… {elapsed}s · {generatingRouteLabel}
                </p>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {pack && (
                <Suspense fallback={<p className="hint" role="status">Loading study pack…</p>}>
                  <StudyPanel key={pack.generatedAt} pack={pack} />
                </Suspense>
              )}
              {pack && (
                <section className="qa" aria-label="Ask about this note">
                  <div className="qa-head">
                    <h2>Ask about this note</h2>
                    {qaMessages.length > 0 && (
                      <button className="qa-clear" onClick={() => void clearQa()} disabled={qaAsking}>
                        Clear history
                      </button>
                    )}
                  </div>
                  <p className="hint">
                    Answers come from this note first. If something is not in the note, the answer
                    says so before answering from general knowledge.
                  </p>
                  <div className="qa-history">
                    {qaMessages.map((m, i) => (
                      <div key={i} className={`qa-msg qa-${m.role}`}>
                        <p className="qa-text">{m.text}</p>
                        {m.role === 'assistant' && m.source && m.latencyMs !== undefined && (
                          <InferenceBadge
                            source={m.source}
                            modelName={m.modelName ?? ''}
                            latencyMs={m.latencyMs}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  {qaStatus && (
                    <p className="generating-status" role="status">
                      {qaStatus}
                    </p>
                  )}
                  {qaError && (
                    <p className="error" role="alert">
                      {qaError}
                    </p>
                  )}
                  <div className="qa-input-row">
                    <input
                      className="qa-input"
                      type="text"
                      placeholder="Ask about this note…"
                      value={qaQuestion}
                      disabled={qaAsking}
                      onChange={(e) => setQaQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void askQa();
                      }}
                      aria-label="Ask a question about this note"
                    />
                    <button
                      className="primary"
                      onClick={() => void askQa()}
                      disabled={qaAsking || !qaQuestion.trim()}
                    >
                      Ask
                    </button>
                  </div>
                  <p className="hint">
                    History is saved on this device, like your study packs. It is not synced to
                    Firestore.
                  </p>
                </section>
              )}
              {!pack && !generating && (
                <p className="hint">
                  No study pack for this note yet. Press <strong>Generate study pack</strong> to get a
                  summary, key points, flashcards and a quiz — with a badge showing exactly where the
                  AI ran.
                </p>
              )}
            </>
          ) : (
            <div className="welcome">
              <h2>Your notes, studied by AI — even offline.</h2>
              <p>
                PocketScholar turns study notes into summaries, flashcards and quizzes. Type a note,
                import a file, or scan a photo of a printed page — short notes run
                entirely on your device with Gemini Nano; longer notes fall back to Gemini in the cloud
                via Firebase AI Logic. Every result tells you where it ran and how long it took.
              </p>
              <div className="welcome-actions">
                <button className="primary" onClick={() => createNote()}>
                  + New note
                </button>
                <button onClick={() => setShowSetup(true)}>How it works</button>
              </div>
              <div className="welcome-samples">
                <p>Or try a sample note:</p>
                {SAMPLE_NOTES.map((s) => (
                  <button key={s.id} onClick={() => loadSample(s.id)}>
                    {s.subject} — {s.title.replace(' — sample note', '')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        PocketScholar — built for #BuildHybridAI 2026 · Firebase AI Logic hybrid inference (Gemini Nano
        on-device + Gemini cloud) · Photo OCR on-device (Tesseract.js) · Ask questions about your notes ·
        Notes stay in your browser unless Firestore sync is configured.
      </footer>
    </div>
  );
}
