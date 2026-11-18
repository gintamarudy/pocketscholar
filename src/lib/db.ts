// Offline-first local storage for PocketScholar, built on IndexedDB (no deps).
// Notes and their generated study packs live here first; Firestore sync is a
// best-effort mirror on top (see lib/sync.ts) and never blocks local use.

import type { Note, StoredStudyPack } from './types';

const DB_NAME = 'pocketscholar';
const DB_VERSION = 1;
const NOTES_STORE = 'notes';
const PACKS_STORE = 'studyPacks';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PACKS_STORE)) {
        db.createObjectStore(PACKS_STORE, { keyPath: 'noteId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export function newNoteId(): string {
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listNotes(): Promise<Note[]> {
  const notes = await tx<Note[]>(NOTES_STORE, 'readonly', (s) => s.getAll());
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNote(id: string): Promise<Note | undefined> {
  return tx<Note | undefined>(NOTES_STORE, 'readonly', (s) => s.get(id));
}

export async function saveNote(note: Note): Promise<void> {
  await tx(NOTES_STORE, 'readwrite', (s) => s.put(note));
}

export async function deleteNote(id: string): Promise<void> {
  await tx(NOTES_STORE, 'readwrite', (s) => s.delete(id));
  await tx(PACKS_STORE, 'readwrite', (s) => s.delete(id));
}

export async function getStudyPack(noteId: string): Promise<StoredStudyPack | undefined> {
  return tx<StoredStudyPack | undefined>(PACKS_STORE, 'readonly', (s) => s.get(noteId));
}

export async function saveStudyPack(pack: StoredStudyPack): Promise<void> {
  await tx(PACKS_STORE, 'readwrite', (s) => s.put(pack));
}
