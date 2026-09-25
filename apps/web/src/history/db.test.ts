import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportMarkdown } from "../backend/intelligence";
import {
  createVault,
  eraseVault,
  lockVault,
} from "../intelligence/vault";
import {
  MEETING_SCHEMA_VERSION,
  deleteMeeting,
  getMeeting,
  getMeetingAudio,
  listMeetings,
  saveMeeting,
  saveMeetingAudio,
  type MeetingRecord,
} from "./db";

const PASSPHRASE = "correct horse battery";

type StoreMap = Map<string, unknown>;

function installStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

function installFakeIndexedDb(): {
  read: (databaseName: string, storeName: string) => unknown[];
  plant: (
    databaseName: string,
    storeName: string,
    value: { id: string },
  ) => void;
} {
  const databases = new Map<string, Map<string, StoreMap>>();

  const ensureDatabase = (name: string): Map<string, StoreMap> => {
    const existing = databases.get(name);
    if (existing) return existing;
    const created = new Map<string, StoreMap>();
    databases.set(name, created);
    return created;
  };

  const createRequest = () => ({
    result: undefined as unknown,
    error: null as unknown,
    transaction: null as unknown,
    onsuccess: null as null | (() => void),
    onerror: null as null | (() => void),
    onupgradeneeded: null as null | (() => void),
  });

  const succeed = (
    request: ReturnType<typeof createRequest>,
    result: unknown,
  ) => {
    request.result = result;
    queueMicrotask(() => {
      request.onsuccess?.();
    });
  };

  const createStore = (records: StoreMap) => ({
    indexNames: { contains: () => true },
    createIndex: () => undefined,
    put: (value: { id: string }) => {
      const request = createRequest();
      records.set(value.id, value);
      succeed(request, value.id);
      return request;
    },
    get: (id: string) => {
      const request = createRequest();
      succeed(request, records.get(id));
      return request;
    },
    getAll: () => {
      const request = createRequest();
      succeed(request, [...records.values()]);
      return request;
    },
    delete: (id: string) => {
      const request = createRequest();
      records.delete(id);
      succeed(request, undefined);
      return request;
    },
  });

  const storeFor = (stores: Map<string, StoreMap>, storeName: string) => {
    const existing = stores.get(storeName);
    if (existing) return createStore(existing);
    const created = new Map<string, unknown>();
    stores.set(storeName, created);
    return createStore(created);
  };

  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open: (name: string) => {
      const request = createRequest();
      const stores = ensureDatabase(name);
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: {
            contains: (storeName: string) => stores.has(storeName),
          },
          createObjectStore: (storeName: string) => storeFor(stores, storeName),
          transaction: (storeName: string) => ({
            objectStore: () => storeFor(stores, storeName),
            onerror: null,
            error: null,
          }),
        };
        request.transaction = {
          objectStore: (storeName: string) => storeFor(stores, storeName),
        };
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    read: (databaseName, storeName) => [
      ...(databases.get(databaseName)?.get(storeName)?.values() ?? []),
    ],
    plant: (databaseName, storeName, value) => {
      const stores = ensureDatabase(databaseName);
      const records = stores.get(storeName) ?? new Map<string, unknown>();
      records.set(value.id, value);
      stores.set(storeName, records);
    },
  };
}

function sampleMeeting(id = "meeting-1"): MeetingRecord {
  return {
    id,
    title: "Secret planning",
    startedAt: 10,
    durationMs: 1000,
    transcript: [{ text: "quarterly numbers", startMs: 0, endMs: 400 }],
    manualNotes: "do not leak",
    generatedNotes: {},
    summary: null,
    updatedAt: 20,
  };
}

let database: ReturnType<typeof installFakeIndexedDb>;

beforeEach(async () => {
  installStorage();
  database = installFakeIndexedDb();
  lockVault();
  await createVault({}, PASSPHRASE);
});

afterEach(() => {
  lockVault();
  eraseVault();
});

describe("meeting persistence contract", () => {
  it("exports transcript and notes as markdown without executing input", () => {
    const markdown = exportMarkdown({
      title: "<Planning>",
      transcript: [{ text: "Ship Friday", startMs: 1000, endMs: 2000 }],
      manualNotes: "Remember QA",
      generatedNotes: {},
      summary: {
        executiveSummary: "Ship the release.",
        keyPoints: ["Ship Friday"],
        actionItems: [],
      },
    });
    expect(markdown).toContain("# <Planning>");
    expect(markdown).toContain("Ship Friday");
    expect(markdown).toContain("Remember QA");
  });

  it("has an explicit schema version for future migrations", () => {
    expect(MEETING_SCHEMA_VERSION).toBe(6);
  });
});

describe("encrypted meeting vault", () => {
  it("stores meetings as ciphertext and reads them back while unlocked", async () => {
    await saveMeeting(sampleMeeting());
    const stored = JSON.stringify(database.read("transcriber-meetings", "meetings"));
    expect(stored).not.toContain("Secret planning");
    expect(stored).not.toContain("quarterly numbers");
    expect(stored).not.toContain("do not leak");
    expect(await listMeetings()).toEqual([sampleMeeting()]);
    expect(await getMeeting("meeting-1")).toEqual(sampleMeeting());
  });

  it("refuses to read or write meetings while the vault is locked", async () => {
    lockVault();
    await expect(saveMeeting(sampleMeeting())).rejects.toThrow(/Unlock the vault/);
    await expect(listMeetings()).rejects.toThrow(/Unlock the vault/);
  });

  it("seals a legacy plaintext meeting the next time the vault is unlocked", async () => {
    database.plant("transcriber-meetings", "meetings", sampleMeeting("legacy"));
    const meetings = await listMeetings();
    expect(meetings.map((meeting) => meeting.id)).toEqual(["legacy"]);
    const stored = JSON.stringify(
      database.read("transcriber-meetings", "meetings"),
    );
    expect(stored).not.toContain("Secret planning");
    expect(stored).toContain('"v":1');
  });

  it("seals meeting audio and plays it back as a blob", async () => {
    const payload = "SUPER_SECRET_AUDIO_PAYLOAD";
    await saveMeetingAudio({
      id: "meeting-1",
      blob: new Blob([payload], { type: "audio/webm" }),
      mimeType: "audio/webm",
      bytes: payload.length,
      durationMs: 1500,
      savedAt: 30,
    });
    const stored = database.read("transcriber-meetings", "audio");
    expect(JSON.stringify(stored)).not.toContain(payload);
    const opened = await getMeetingAudio("meeting-1");
    expect(opened?.mimeType).toBe("audio/webm");
    expect(opened?.durationMs).toBe(1500);
    expect(await opened?.blob.text()).toBe(payload);
  });

  it("deletes the sealed meeting and its audio together", async () => {
    await saveMeeting(sampleMeeting());
    await saveMeetingAudio({
      id: "meeting-1",
      blob: new Blob(["audio"]),
      mimeType: "audio/webm",
      bytes: 5,
      durationMs: 1,
      savedAt: 1,
    });
    await deleteMeeting("meeting-1");
    expect(database.read("transcriber-meetings", "meetings")).toEqual([]);
    expect(database.read("transcriber-meetings", "audio")).toEqual([]);
    expect(await getMeeting("meeting-1")).toBeUndefined();
  });
});
