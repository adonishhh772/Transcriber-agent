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
};

const DB_NAME = "transcriber-meetings";
const STORE = "meetings";
export const MEETING_SCHEMA_VERSION = 2;

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
}

function transaction(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("indexeddb_request_failed"));
    tx.onerror = () =>
      reject(tx.error ?? new Error("indexeddb_transaction_failed"));
  });
}
