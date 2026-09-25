import type { TranscriptSegment } from "../transcript/dedup";
import type { AiActivityEntry } from "../intelligence/activity";
import type { NoteSectionKey, NotesSource } from "../intelligence/notes";
import { isVaultUnlocked, VaultLockedError } from "../intelligence/vault";
import {
  isPlainAudio,
  isPlainMeeting,
  isSealedAudio,
  isSealedMeeting,
  openSealedAudio,
  openSealedMeeting,
  sealAudioRecord,
  sealMeetingRecord,
} from "./seal";

/** One question asked about a finished meeting, with the answer it received. */
export type MeetingQuestion = {
  /** Milliseconds since this meeting started. */
  atMs: number;
  question: string;
  answer: string;
};

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
  screenNotes?: Array<{ atMs: number; text: string; thumbnail?: string }>;
  /** Changelog of what the AI suggested and when it changed. */
  aiActivity?: AiActivityEntry[];
  /** Questions asked about this meeting, in order. */
  qa?: MeetingQuestion[];
  /** What each notes pass was given, oldest first. */
  noteSources?: NotesSource[];
  /** Which pass wrote each section, as an index into `noteSources`. */
  noteSourceRef?: Partial<Record<NoteSectionKey, number>>;
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
/** Version 6 seals every meeting and its audio with the vault key. */
export const MEETING_SCHEMA_VERSION = 6;

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

function requireUnlockedVault(): void {
  if (!isVaultUnlocked()) throw new VaultLockedError();
}

export async function saveMeeting(meeting: MeetingRecord): Promise<void> {
  requireUnlockedVault();
  const sealed = await sealMeetingRecord(meeting);
  const db = await openMeetingDb();
  await transaction(db, "readwrite", (store) => store.put(sealed));
}

export async function listMeetings(): Promise<MeetingRecord[]> {
  requireUnlockedVault();
  const db = await openMeetingDb();
  const items = (await transaction(db, "readonly", (store) =>
    store.getAll(),
  )) as unknown[];
  const meetings: MeetingRecord[] = [];
  for (const item of items) {
    if (isPlainMeeting(item)) {
      await saveMeeting(item);
      meetings.push(item);
      continue;
    }
    if (isSealedMeeting(item)) meetings.push(await openSealedMeeting(item));
  }
  meetings.sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  return meetings;
}

export async function getMeeting(
  id: string,
): Promise<MeetingRecord | undefined> {
  requireUnlockedVault();
  const db = await openMeetingDb();
  const stored = await transaction(db, "readonly", (store) => store.get(id));
  if (!stored) return undefined;
  if (isPlainMeeting(stored)) {
    await saveMeeting(stored);
    return stored;
  }
  if (isSealedMeeting(stored)) return openSealedMeeting(stored);
  return undefined;
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
  requireUnlockedVault();
  const sealed = await sealAudioRecord(record);
  const db = await openMeetingDb();
  await runRequest(db, AUDIO_STORE, "readwrite", (store) => store.put(sealed));
}

export async function getMeetingAudio(
  id: string,
): Promise<MeetingAudioRecord | undefined> {
  requireUnlockedVault();
  const db = await openMeetingDb();
  const stored = await runRequest(db, AUDIO_STORE, "readonly", (store) =>
    store.get(id),
  );
  if (!stored) return undefined;
  if (isPlainAudio(stored)) {
    await saveMeetingAudio(stored);
    return stored;
  }
  if (isSealedAudio(stored)) return openSealedAudio(stored);
  return undefined;
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
