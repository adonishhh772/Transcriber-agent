/**
 * Load-path tests: the model must either become ready or fail loudly.
 *
 * A worker that fails to start, or a download that reports no progress, used to
 * leave the UI on "Loading the Whisper model…" forever because the load promise
 * never settled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WhisperWorkerResponse } from "./protocol";
import { WhisperClient } from "./whisperClient";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  posted: Array<Record<string, unknown>> = [];
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "message") this.listeners.delete(listener);
  }

  postMessage(message: Record<string, unknown>) {
    this.posted.push(message);
  }

  terminate() {}

  /** Delivers a worker → client message. */
  emit(message: WhisperWorkerResponse) {
    for (const listener of [...this.listeners])
      listener({ data: message } as MessageEvent);
  }

  crash(message: string) {
    this.onerror?.({ message });
  }
}

function lastWorker(): FakeWorker {
  return FakeWorker.instances[FakeWorker.instances.length - 1];
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  /* Node 20 has no `navigator` at all, so pin it: the WebGPU probe must simply
     report "no adapter" there. */
  vi.stubGlobal("navigator", {});
  /* `window` does not exist in the node test environment. The shim delegates
     instead of copying, so fake timers installed later still apply. */
  (globalThis as { window?: unknown }).window = {
    setTimeout: (handler: () => void, timeout?: number) =>
      globalThis.setTimeout(handler, timeout),
    clearTimeout: (handle?: number) => globalThis.clearTimeout(handle),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("WhisperClient.load", () => {
  it("resolves once the worker reports the model as loaded", async () => {
    const client = new WhisperClient({ model: "Xenova/whisper-tiny.en" });
    const loading = client.load();
    await vi.waitFor(() => expect(lastWorker().posted).toHaveLength(1));
    expect(lastWorker().posted[0]).toMatchObject({
      type: "load",
      model: "Xenova/whisper-tiny.en",
    });

    lastWorker().emit({
      type: "loaded",
      model: "Xenova/whisper-tiny.en",
      backend: "wasm",
    });
    await expect(loading).resolves.toBeUndefined();
  });

  it("rejects instead of hanging when the worker fails to start", async () => {
    const onError = vi.fn();
    const client = new WhisperClient({
      model: "Xenova/whisper-tiny.en",
      onError,
    });
    const loading = client.load();
    await vi.waitFor(() => expect(lastWorker().posted).toHaveLength(1));

    lastWorker().crash("Failed to construct 'Worker'");

    await expect(loading).rejects.toThrow("Failed to construct 'Worker'");
    expect(onError).toHaveBeenCalledWith("Failed to construct 'Worker'");
  });

  it("rejects when the download reports no progress for two minutes", async () => {
    vi.useFakeTimers();
    const client = new WhisperClient({ model: "Xenova/whisper-tiny.en" });
    const loading = client.load();
    /* Let the backend probe settle and the load message go out first. */
    await vi.advanceTimersByTimeAsync(0);
    expect(lastWorker().posted).toHaveLength(1);
    const rejected = expect(loading).rejects.toThrow(/stalled/i);
    await vi.advanceTimersByTimeAsync(120_001);
    await rejected;
  });

  it("keeps the watchdog alive while progress keeps arriving", async () => {
    vi.useFakeTimers();
    const client = new WhisperClient({ model: "Xenova/whisper-tiny.en" });
    const loading = client.load();
    await vi.advanceTimersByTimeAsync(0);
    for (let tick = 0; tick < 3; tick += 1) {
      await vi.advanceTimersByTimeAsync(100_000);
      lastWorker().emit({ type: "progress", progress: 0.5, status: "loading" });
    }
    await vi.advanceTimersByTimeAsync(60_000);
    lastWorker().emit({
      type: "loaded",
      model: "Xenova/whisper-tiny.en",
      backend: "wasm",
    });
    await expect(loading).resolves.toBeUndefined();
  });

  it("falls back to WASM when WebGPU cannot initialise", async () => {
    vi.stubGlobal("navigator", {
      gpu: { requestAdapter: async () => ({}) },
    });
    const onBackend = vi.fn();
    const client = new WhisperClient({
      model: "Xenova/whisper-tiny.en",
      onBackend,
    });
    const loading = client.load();
    await vi.waitFor(() =>
      expect(lastWorker().posted[0]).toMatchObject({ backend: "webgpu" }),
    );

    lastWorker().emit({ type: "error", message: "webgpu init failed" });
    await vi.waitFor(() => expect(lastWorker().posted).toHaveLength(2));
    expect(lastWorker().posted[1]).toMatchObject({ backend: "wasm" });
    expect(onBackend).toHaveBeenLastCalledWith("wasm");

    lastWorker().emit({
      type: "loaded",
      model: "Xenova/whisper-tiny.en",
      backend: "wasm",
    });
    await expect(loading).resolves.toBeUndefined();
  });

  it("honours a forced CPU backend without probing the GPU", async () => {
    vi.stubGlobal("navigator", {
      gpu: { requestAdapter: async () => ({}) },
    });
    const onBackend = vi.fn();
    const client = new WhisperClient({
      model: "Xenova/whisper-tiny.en",
      forceBackend: "wasm",
      onBackend,
    });
    const loading = client.load();
    await vi.waitFor(() =>
      expect(lastWorker().posted[0]).toMatchObject({ backend: "wasm" }),
    );
    expect(onBackend).toHaveBeenCalledWith("wasm");
    lastWorker().emit({
      type: "loaded",
      model: "Xenova/whisper-tiny.en",
      backend: "wasm",
    });
    await expect(loading).resolves.toBeUndefined();
  });

  it("reuses one load when load() is called repeatedly", async () => {
    const client = new WhisperClient({ model: "Xenova/whisper-tiny.en" });
    const first = client.load();
    const second = client.load();
    await vi.waitFor(() => expect(lastWorker().posted).toHaveLength(1));
    lastWorker().emit({
      type: "loaded",
      model: "Xenova/whisper-tiny.en",
      backend: "wasm",
    });
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    /* One worker, one load message: the second call joined the first. */
    expect(lastWorker().posted).toHaveLength(1);
  });
});
