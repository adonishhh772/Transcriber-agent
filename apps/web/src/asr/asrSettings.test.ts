import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeAsrProvider,
  loadAsrSettings,
  resolveAsrProvider,
  saveAsrSettings,
  type AsrSettings,
} from "./asrSettings";

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("asr settings", () => {
  it("defaults to Deepgram with a local fallback available", () => {
    const settings = loadAsrSettings();
    expect(settings.provider).toBe("deepgram");
    expect(settings.deepgramModel).toBe("nova-3");
    expect(settings.language).toBe("en");
    expect(settings.localModel).toContain("whisper");
    expect(settings.chunkSeconds).toBe(6);
    expect(settings.overlapSeconds).toBe(2);
    /* Local-only mode is on until the user turns it off, and that choice is
       stored rather than re-armed on every reload. */
    expect(settings.localOnly).toBe(true);
    expect(settings.recordAudio).toBe(true);
    expect(settings.readScreen).toBe(true);
    /* Screenshots in the transcript are on by default, and opt-out. */
    expect(settings.keepScreenImages).toBe(true);
  });

  it("round-trips a saved choice", () => {
    const settings: AsrSettings = {
      provider: "local",
      deepgramModel: "nova-2",
      language: "en-GB",
      localModel: "Xenova/whisper-base",
      chunkSeconds: 8,
      overlapSeconds: 1.5,
      localOnly: false,
      recordAudio: false,
      readScreen: false,
      keepScreenImages: false,
    };
    saveAsrSettings(settings);
    expect(loadAsrSettings()).toEqual(settings);
  });

  it("keeps the capture choices a reload used to reset", () => {
    localStorage.setItem(
      "gather.asr.v1",
      JSON.stringify({
        localModel: "Xenova/whisper-small.en",
        chunkSeconds: 12,
        overlapSeconds: 3,
        localOnly: false,
        recordAudio: true,
      }),
    );
    const settings = loadAsrSettings();
    expect(settings.localModel).toBe("Xenova/whisper-small.en");
    expect(settings.chunkSeconds).toBe(12);
    expect(settings.overlapSeconds).toBe(3);
    expect(settings.localOnly).toBe(false);
  });

  it("repairs a stored number that is out of range or nonsense", () => {
    localStorage.setItem(
      "gather.asr.v1",
      JSON.stringify({ chunkSeconds: 900, overlapSeconds: "wide" }),
    );
    const settings = loadAsrSettings();
    expect(settings.chunkSeconds).toBe(30);
    expect(settings.overlapSeconds).toBe(2);
  });

  it("keeps screen images on for a stored older choice", () => {
    localStorage.setItem(
      "gather.asr.v1",
      JSON.stringify({
        provider: "local",
        deepgramModel: "nova-2",
        language: "en",
        localModel: "Xenova/whisper-tiny.en",
        recordAudio: true,
        readScreen: true,
      }),
    );
    expect(loadAsrSettings().keepScreenImages).toBe(true);
  });
});

describe("resolveAsrProvider", () => {
  const cloud: AsrSettings = {
    provider: "deepgram",
    deepgramModel: "nova-3",
    language: "en",
    localModel: "Xenova/whisper-tiny.en",
    chunkSeconds: 6,
    overlapSeconds: 2,
    localOnly: false,
    recordAudio: true,
    readScreen: true,
    keepScreenImages: true,
  };

  it("uses Deepgram when a key is present", () => {
    expect(
      resolveAsrProvider(cloud, { localOnly: false, deepgramKey: "dg-key" }),
    ).toBe("deepgram");
  });

  it("falls back to local without a key", () => {
    expect(
      resolveAsrProvider(cloud, { localOnly: false, deepgramKey: "  " }),
    ).toBe("local");
  });

  it("honours local-only mode over the cloud choice", () => {
    expect(
      resolveAsrProvider(cloud, { localOnly: true, deepgramKey: "dg-key" }),
    ).toBe("local");
  });

  it("explains each state", () => {
    expect(
      describeAsrProvider(cloud, { localOnly: false, deepgramKey: "dg-key" }),
    ).toMatch(/streamed to Deepgram/i);
    expect(
      describeAsrProvider(cloud, { localOnly: false, deepgramKey: "" }),
    ).toMatch(/Add a Deepgram API key/i);
    expect(
      describeAsrProvider(cloud, { localOnly: true, deepgramKey: "dg-key" }),
    ).toMatch(/no audio leaves the device/i);
  });
});
