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
  });

  it("round-trips a saved choice", () => {
    const settings: AsrSettings = {
      provider: "local",
      deepgramModel: "nova-2",
      language: "en-GB",
      localModel: "Xenova/whisper-base",
    };
    saveAsrSettings(settings);
    expect(loadAsrSettings()).toEqual(settings);
  });
});

describe("resolveAsrProvider", () => {
  const cloud: AsrSettings = {
    provider: "deepgram",
    deepgramModel: "nova-3",
    language: "en",
    localModel: "Xenova/whisper-tiny.en",
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
