/**
 * Integration test for the streaming controller with a stubbed Whisper client.
 *
 * The scheduler logic is unit-tested on its own; this file covers the wiring
 * around it — buffer bookkeeping, window coverage, timestamp offsets and the
 * backpressure behaviour — without a browser, a worker or a model.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { CaptureStreams } from "../capture/browserCapture";
import type { TranscriptSegment } from "../transcript/dedup";
import { TranscriptionController } from "./transcriptionController";
import type { WhisperClient } from "./whisperClient";

type Call = { startMs: number; endMs: number; samples: number };

const state = {
  calls: [] as Call[],
  releases: [] as Array<() => void>,
};

/** Stub for the injected client: the controller no longer builds its own. */
function fakeClient(): WhisperClient {
  return {
    async load(): Promise<void> {},
    transcribe(samples: Float32Array, startMs: number, endMs: number) {
      state.calls.push({ startMs, endMs, samples: samples.length });
      return new Promise((resolve) => {
        state.releases.push(() =>
          resolve({ text: `window ${startMs} ${endMs}`, startMs, endMs }),
        );
      });
    },
    dispose(): void {},
  } as unknown as WhisperClient;
}

const BLOCK = 4096;
const SR = 16_000;

/** Lets the controller's promise chain settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const processor = {
    onaudioprocess: null as
      | ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void)
      | null,
    connect: () => {},
    disconnect: () => {},
  };
  const context = {
    sampleRate: SR,
    destination: {},
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    createScriptProcessor: () => processor,
    createGain: () => ({
      gain: { value: 0 },
      connect: () => {},
      disconnect: () => {},
    }),
  };
  const segments: TranscriptSegment[] = [];
  const errors: string[] = [];
  const controller = new TranscriptionController(
    {
      chunkDurationMs: 6000,
      overlapMs: 2000,
      silenceRmsThreshold: 0.008,
      model: "test-model",
      language: "en",
    },
    {
      onState: () => {},
      onSegment: (segment) => void segments.push(segment),
      onLag: () => {},
      onError: (message) => void errors.push(message),
    },
    fakeClient(),
  );

  return {
    controller,
    segments,
    errors,
    capture: { audioContext: context, mixed: {} } as unknown as CaptureStreams,
    /** Feeds n blocks of audio, releasing finished inferences as they appear. */
    async pump(blocks: number, amplitude = 0.2, release = true) {
      for (let index = 0; index < blocks; index += 1) {
        const block = new Float32Array(BLOCK).fill(amplitude);
        processor.onaudioprocess?.({
          inputBuffer: { getChannelData: () => block },
        });
        await flush();
        if (!release) continue;
        while (state.releases.length > 0) {
          state.releases.shift()?.();
          await flush();
        }
      }
      await flush();
    },
  };
}

beforeEach(() => {
  state.calls = [];
  state.releases = [];
});

describe("live transcription", () => {
  it("starts with a short window so the first words arrive sooner", async () => {
    const harness = setup();
    await harness.controller.start(harness.capture);
    await harness.pump(11); // ~2.8s of audio

    expect(state.calls.length).toBeGreaterThan(0);
    const first = state.calls[0];
    expect(first.startMs).toBe(0);
    expect(first.endMs).toBe(2500); // not a full 6s window
  });

  it("covers every sample: each window starts before the previous one ends", async () => {
    const harness = setup();
    await harness.controller.start(harness.capture);
    await harness.pump(80); // ~20s of audio

    expect(state.calls.length).toBeGreaterThan(3);
    for (let index = 1; index < state.calls.length; index += 1) {
      const previous = state.calls[index - 1];
      const current = state.calls[index];
      expect(current.startMs).toBeGreaterThan(previous.startMs);
      expect(current.startMs).toBeLessThanOrEqual(previous.endMs);
      expect(current.samples).toBe(
        Math.round(((current.endMs - current.startMs) * SR) / 1000),
      );
    }
  });

  it("emits timestamped segments that track the live edge", async () => {
    const harness = setup();
    await harness.controller.start(harness.capture);
    await harness.pump(80);

    expect(harness.errors).toEqual([]);
    expect(harness.segments.length).toBeGreaterThan(3);
    const pushedMs = (80 * BLOCK * 1000) / SR;
    const last = harness.segments[harness.segments.length - 1];
    for (let index = 1; index < harness.segments.length; index += 1)
      expect(harness.segments[index].startMs).toBeGreaterThanOrEqual(
        harness.segments[index - 1].startMs,
      );
    // Windows are whole-window bounds, so the tail of the newest one is live.
    expect(last.endMs).toBeGreaterThan(pushedMs - 7000);
  });

  it("drops stale audio instead of drifting behind a slow inference", async () => {
    const harness = setup();
    await harness.controller.start(harness.capture);
    await harness.pump(11, 0.2, false); // first inference never completes
    expect(state.calls.length).toBe(1);

    await harness.pump(80, 0.2, false); // ~20s arrives while it is in flight
    expect(harness.controller.getSkippedMs()).toBeGreaterThan(0);

    while (state.releases.length > 0) {
      state.releases.shift()?.();
      await flush();
    }
    await harness.pump(10);

    const latest = state.calls[state.calls.length - 1];
    const pushedMs = (91 * BLOCK * 1000) / SR + (10 * BLOCK * 1000) / SR;
    expect(latest.startMs).toBeGreaterThan(pushedMs - 7000);
  });

  it("ignores silence without accumulating it, then snaps back to a short window", async () => {
    const harness = setup();
    await harness.controller.start(harness.capture);
    await harness.pump(78, 0.001); // ~20s of near-silence
    expect(state.calls).toEqual([]);

    await harness.pump(11); // speech resumes
    expect(state.calls.length).toBeGreaterThan(0);
    const first = state.calls[0];
    expect(first.endMs - first.startMs).toBe(2500);
    expect(first.startMs).toBeGreaterThan(0);
    expect(harness.controller.getSkippedMs()).toBe(0);
  });
});
