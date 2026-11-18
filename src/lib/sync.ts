// Firestore sync for PocketScholar (best-effort mirror of the local store).
//
// Local IndexedDB is always the source of truth. When Firebase is configured
// AND the browser is online, notes are mirrored to the `notes` collection
// (one document per note, keyed by the local note id, under a per-browser
// device id — no auth is used in M1). Sync never blocks the UI and never
// throws to callers: failures are reported through the returned status.
//
// Firestore rules (firestore.rules) allow read/write only under a device's
// own `devices/{deviceId}/notes/{noteId}` path.
//
// Code-splitting: `firebase/firestore` is imported dynamically, so this
// module (and the Firestore SDK) only loads when sync actually runs.

import { getFirestoreClient } from './firebase';
import { isFirebaseConfigured } from './firebase-config';
import type { Note } from './types';

const DEVICE_KEY = 'pocketscholar-device-id';

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `device_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

async function notesCollection() {
  const db = await getFirestoreClient();
  if (!db) return null;
  const { collection } = await import('firebase/firestore');
  return collection(db, 'devices', getDeviceId(), 'notes');
}

/** Push one note to Firestore. Returns false when sync is unavailable. */
export async function pushNote(note: Note): Promise<boolean> {
  if (!isFirebaseConfigured() || !navigator.onLine) return false;
  const col = await notesCollection();
  if (!col) return false;
  try {
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(col, note.id), {
      title: note.title,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
    return true;
  } catch (err) {
    console.warn('[PocketScholar] Firestore push failed:', err);
    return false;
  }
}

/** Pull remote notes (newer `updatedAt` wins over the local copy). */
export async function pullNotes(local: Note[]): Promise<Note[]> {
  if (!isFirebaseConfigured() || !navigator.onLine) return local;
  const col = await notesCollection();
  if (!col) return local;
  try {
    const { getDocs } = await import('firebase/firestore');
    const snap = await getDocs(col);
    const byId = new Map(local.map((n) => [n.id, n]));
    snap.forEach((d) => {
      const data = d.data() as { title: string; content: string; createdAt: number; updatedAt: number };
      const remote: Note = {
        id: d.id,
        title: data.title ?? 'Untitled',
        content: data.content ?? '',
        createdAt: data.createdAt ?? Date.now(),
        updatedAt: data.updatedAt ?? Date.now(),
      };
      const existing = byId.get(d.id);
      if (!existing || remote.updatedAt > existing.updatedAt) byId.set(d.id, remote);
    });
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.warn('[PocketScholar] Firestore pull failed:', err);
    return local;
  }
}
