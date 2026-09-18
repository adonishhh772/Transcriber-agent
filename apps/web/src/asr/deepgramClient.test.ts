import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepgramStreamingClient, buildListenUrl } from "./deepgramClient";

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];

  static reset(): void {
    FakeWebSocket.instances = [];
  }
  static get last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  sent: unknown[] = [];

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: "" });
  }

  /* test helpers */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

function client(overrides: Record<string, unknown> = {}) {
  return new DeepgramStreamingClient({
    apiKey: "dg-test-key",
    model: "nova-3",
    language: "en",
    ...overrides,
  });
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("buildListenUrl", () => {
  it("asks for 16 kHz mono PCM with interim results", () => {
    const url = new URL(
      buildListenUrl({ model: "nova-3", language: "en", sampleRate: 16_000 }),
    );
    expect(url.protocol).toBe("wss:");
    expect(url.host).toBe("api.deepgram.com");
    expect(url.pathname).toBe("/v1/listen");
    for (const [key, value] of Object.entries({
      model: "nova-3",
      language: "en",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
    }))
      expect(url.searchParams.get(key)).toBe(value);
  });
});

describe("DeepgramStreamingClient", () => {
  it("authenticates with the token sub-protocol, keeping the key out of the URL", async () => {
    const streaming = client();
    const connecting = streaming.connect();
    expect(FakeWebSocket.last.url).not.toContain("dg-test-key");
    expect(FakeWebSocket.last.protocols).toEqual(["token", "dg-test-key"]);
    FakeWebSocket.last.open();
    await expect(connecting).resolves.toBeUndefined();
    expect(streaming.status).toBe("open");
  });

  it("sends 16-bit PCM frames", async () => {
    const streaming = client();
    const connecting = streaming.connect();
    FakeWebSocket.last.open();
    await connecting;

    streaming.send(new Float32Array(1600).fill(0.5));
    const frame = FakeWebSocket.last.sent[0] as ArrayBuffer;
    expect(frame).toBeInstanceOf(ArrayBuffer);
    expect(frame.byteLength).toBe(1600 * 2);
    // 0.5 in float becomes half of 32767 in int16.
    expect(new Int16Array(frame)[0]).toBeGreaterThan(16000);
  });

  it("reports interim words and then a final segment with timings", async () => {
    const interim: string[] = [];
    const finals: Array<{ text: string; startMs: number; endMs: number; words?: unknown }> = [];
    const streaming = client({
      onInterim: (text: string) => interim.push(text),
      onFinal: (segment: unknown) => finals.push(segment as never),
    });
    const connecting = streaming.connect();
    FakeWebSocket.last.open();
    await connecting;

    FakeWebSocket.last.deliver({
      type: "Results",
      is_final: false,
      channel: { alternatives: [{ transcript: "hello there" }] },
    });
    expect(interim).toEqual(["hello there"]);
    expect(finals).toEqual([]);

    FakeWebSocket.last.deliver({
      type: "Results",
      is_final: true,
      start: 1.5,
      duration: 2,
      channel: {
        alternatives: [
          {
            transcript: "hello there everyone",
            words: [
              { word: "hello", start: 1.5, end: 1.8 },
              { word: "everyone", punctuated_word: "everyone.", start: 1.9, end: 3.5 },
            ],
          },
        ],
      },
    });
    expect(interim[interim.length - 1]).toBe("");
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({
      text: "hello there everyone",
      startMs: 1500,
      endMs: 3500,
    });
    expect(finals[0].words).toEqual([
      { w: "hello", t: 1500, end: 1800 },
      { w: "everyone.", t: 1900, end: 3500 },
    ]);
  });

  it("keeps the socket alive while no words are coming", async () => {
    vi.useFakeTimers();
    const streaming = client();
    const connecting = streaming.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last.open();
    await connecting;

    await vi.advanceTimersByTimeAsync(8_100);
    expect(FakeWebSocket.last.sent).toContainEqual(
      JSON.stringify({ type: "KeepAlive" }),
    );
  });

  it("closes the stream politely", async () => {
    const streaming = client();
    const connecting = streaming.connect();
    FakeWebSocket.last.open();
    await connecting;

    await streaming.close();
    expect(FakeWebSocket.last.sent).toContainEqual(
      JSON.stringify({ type: "CloseStream" }),
    );
    expect(streaming.status).toBe("closed");
  });

  it("retries once with the query form before giving up", async () => {
    vi.useFakeTimers();
    const errors: string[] = [];
    const streaming = client({ onError: (m: string) => errors.push(m) });
    const connecting = streaming.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last.open();
    await connecting;

    FakeWebSocket.last.drop(1006, "");
    await vi.advanceTimersByTimeAsync(600);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.last.url).toContain("access_token=dg-test-key");

    FakeWebSocket.last.drop(1006, "");
    await vi.advanceTimersByTimeAsync(1_200);
    FakeWebSocket.last.drop(1006, "");
    await vi.advanceTimersByTimeAsync(2_400);
    FakeWebSocket.last.drop(1006, "");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(errors.join(" ")).toMatch(/closed|refused/i);
    expect(streaming.status).toBe("error");
  });

  it("explains a rejected key instead of retrying forever", async () => {
    const errors: string[] = [];
    const streaming = client({ onError: (m: string) => errors.push(m) });
    const connecting = streaming.connect();
    FakeWebSocket.last.open();
    await connecting;

    FakeWebSocket.last.deliver({ type: "Error", description: "Invalid credentials" });
    expect(errors).toEqual(["Invalid credentials"]);
  });
});
