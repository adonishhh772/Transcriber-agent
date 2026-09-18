import type { TranscriptSegment } from "../transcript/dedup";

export type MeetingRecord = {
  id: string;
  title: string;
  startedAt: number;
  durationMs: number;
  transcript: TranscriptSegment[];
  manualNotes: string;
  generatedNotes: Record<string, unknown>;
  summary: Record<string, unknown> | null;
  updatedAt: number;
  /** Set when meeting audio was saved under this id. */
  hasAudio?: boolean;
  /** What the shared screen showed, in order. */
  screenNotes?: Array<{ atMs: number; text: string }>;
};

/**
 * Meeting audio lives in its own store: `listMeetings()` must stay cheap, and
 * pulling every recording into the library list would not be.
 */
export type MeetingAudioRecord = {
  id: string;
  blob: Blob;
  mimeType: string;
  bytes: number;
  durationMs: number;
  savedAt: number;
};

const DB_NAME = "transcriber-meetings";
const STORE = "meetings";
const AUDIO_STORE = "audio";
export const MEETING_SCHEMA_VERSION = 3;

export function openMeetingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, MEETING_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      const store = db.objectStoreNames.contains(STORE)
        ? transaction!.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: "id" });
      if (!store.indexNames.contains("updatedAt"))
        store.createIndex("updatedAt", "updatedAt");
      if (!store.indexNames.contains("title"))
        store.createIndex("title", "title");
      if (!db.objectStoreNames.contains(AUDIO_STORE))
        db.createObjectStore(AUDIO_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("indexeddb_open_failed"));
  });
}

export async function saveMeeting(meeting: MeetingRecord): Promise<void> {
  const db = await openMeetingDb();
  await transaction(db, "readwrite", (store) => store.put(meeting));
}

export async function listMeetings(): Promise<MeetingRecord[]> {
  const db = await openMeetingDb();
  return transaction(db, "readonly", (store) => store.getAll()).then((items) =>
    (items as MeetingRecord[]).sort((a, b) => b.updatedAt - a.updatedAt),
  );
}

export async function getMeeting(
  id: string,
): Promise<MeetingRecord | undefined> {
  const db = await openMeetingDb();
  return transaction(db, "readonly", (store) => store.get(id)) as Promise<
    MeetingRecord | undefined
  >;
}

export async function deleteMeeting(id: string): Promise<void> {
  const db = await openMeetingDb();
  await transaction(db, "readwrite", (store) => store.delete(id));
  await deleteMeetingAudio(id);
}

/* ---------------------------------------------------------------------------
   Meeting audio
   ------------------------------------------------------------------------ */

export async function saveMeetingAudio(record: MeetingAudioRecord): Promise<void> {
  const db = await openMeetingDb();
  await runRequest(db, AUDIO_STORE, "readwrite", (store) => store.put(record));
}

export async function getMeetingAudio(
  id: string,
): Promise<MeetingAudioRecord | undefined> {
  const db = await openMeetingDb();
  return runRequest(db, AUDIO_STORE, "readonly", (store) => store.get(id)) as Promise<
    MeetingAudioRecord | undefined
  >;
}

export async function deleteMeetingAudio(id: string): Promise<void> {
  const db = await openMeetingDb();
  await runRequest(db, AUDIO_STORE, "readwrite", (store) => store.delete(id));
}

function transaction(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return runRequest(db, STORE, mode, action);
}

function runRequest(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("indexeddb_request_failed"));
    tx.onerror = () =>
      reject(tx.error ?? new Error("indexeddb_transaction_failed"));
  });
}
