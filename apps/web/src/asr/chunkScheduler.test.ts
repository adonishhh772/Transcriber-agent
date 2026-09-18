import { describe, expect, it } from "vitest";
import {
  hopMsFor,
  msToSamples,
  planChunk,
  resolveScheduler,
  windowMsFor,
  type ChunkSchedulerConfig,
} from "./chunkScheduler";

const SR = 16_000;

function scheduler(overrides: Partial<ChunkSchedulerConfig> = {}) {
  return resolveScheduler({
    sampleRate: SR,
    chunkMs: 6000,
    overlapMs: 2000,
    ...overrides,
  });
}

describe("resolveScheduler", () => {
  it("keeps sane bounds for hostile settings", () => {
    const resolved = scheduler({ overlapMs: 99_999, firstChunkMs: 1 });
    expect(resolved.overlapMs).toBe(6000);
    expect(resolved.firstChunkMs).toBe(250);
    expect(resolved.minHopMs).toBeLessThanOrEqual(6000);
    expect(resolved.maxInFlight).toBe(1);
  });
});

describe("window and hop", () => {
  it("starts with a short window so the first words arrive sooner", () => {
    expect(windowMsFor({ preferShortChunk: true }, scheduler())).toBe(2500);
    expect(windowMsFor({ preferShortChunk: false }, scheduler())).toBe(6000);
  });

  it("uses the configured overlap until an inference has been measured", () => {
    expect(hopMsFor({ lastInferenceMs: 0, preferShortChunk: false }, scheduler())).toBe(
      4000,
    );
  });

  it("widens the hop on a slow device instead of falling behind", () => {
    // 2.5s per inference at a 0.65 duty target -> ~3.85s stride.
    expect(
      hopMsFor({ lastInferenceMs: 2500, preferShortChunk: false }, scheduler()),
    ).toBeCloseTo(3846, -1);
    // A hopeless device is capped at window - minOverlap: gap-free coverage.
    expect(
      hopMsFor({ lastInferenceMs: 20_000, preferShortChunk: false }, scheduler()),
    ).toBe(5750);
  });

  it("narrows the hop on a fast GPU for near-continuous updates", () => {
    expect(
      hopMsFor({ lastInferenceMs: 300, preferShortChunk: false }, scheduler()),
    ).toBe(1200);
  });
});

describe("planChunk", () => {
  const base = {
    consumedSample: 0,
    preferShortChunk: false,
    lastInferenceMs: 0,
    inFlight: 0,
  };

  it("waits until a whole window is available", () => {
    expect(
      planChunk({ ...base, availableSample: msToSamples(5999, SR) }, scheduler()),
    ).toEqual({ action: "wait" });
  });

  it("runs a full window and never advances past its end", () => {
    const plan = planChunk(
      { ...base, availableSample: msToSamples(6000, SR) },
      scheduler(),
    );
    expect(plan).toEqual({
      action: "run",
      startSample: 0,
      endSample: msToSamples(6000, SR),
      nextSample: msToSamples(4000, SR),
    });
    if (plan.action !== "run") throw new Error("expected a run");
    expect(plan.nextSample).toBeLessThanOrEqual(plan.endSample);
  });

  it("refuses to start a second inference while one is in flight", () => {
    expect(
      planChunk(
        { ...base, availableSample: msToSamples(7000, SR), inFlight: 1 },
        scheduler(),
      ),
    ).toEqual({ action: "wait" });
  });

  it("drops stale audio once the backlog passes a window plus a hop", () => {
    const plan = planChunk(
      { ...base, availableSample: msToSamples(12_000, SR), inFlight: 1 },
      scheduler(),
    );
    expect(plan.action).toBe("skip");
    if (plan.action !== "skip") throw new Error("expected a skip");
    expect(plan.nextSample).toBe(msToSamples(6000, SR));
    expect(plan.droppedMs).toBe(6000);
  });
});

describe("live streaming simulation", () => {
  /** 10 minutes of audio in 100ms steps, one inference at a time. */
  function run(inferenceMs: number) {
    const sched = scheduler();
    const stepMs = 100;
    const stepSamples = msToSamples(stepMs, SR);
    let available = 0;
    let consumed = 0;
    let inFlight = 0;
    let finishesAt = 0;
    let now = 0;
    let measured = 0;
    let maxLagMs = 0;
    let skippedMs = 0;
    let runs = 0;

    for (let tick = 0; tick < 6000; tick += 1) {
      available += stepSamples;
      now += stepMs;
      if (inFlight > 0 && now >= finishesAt) {
        inFlight = 0;
        measured = inferenceMs;
      }
      const plan = planChunk(
        {
          availableSample: available,
          consumedSample: consumed,
          preferShortChunk: false,
          lastInferenceMs: measured,
          inFlight,
        },
        sched,
      );
      if (plan.action === "run") {
        consumed = plan.nextSample;
        inFlight = 1;
        finishesAt = now + inferenceMs;
        runs += 1;
      } else if (plan.action === "skip") {
        consumed = plan.nextSample;
        skippedMs += plan.droppedMs;
      }
      maxLagMs = Math.max(
        maxLagMs,
        ((available - consumed) * 1000) / SR,
      );
    }
    return { maxLagMs, skippedMs, runs };
  }

  it("keeps the transcript near real time on a slow CPU fallback", () => {
    const { maxLagMs, skippedMs } = run(2500);
    expect(maxLagMs).toBeLessThanOrEqual(12_000);
    expect(skippedMs).toBe(0);
  });

  it("stays bounded even when the device cannot keep up at all", () => {
    const { maxLagMs, skippedMs } = run(9000);
    expect(maxLagMs).toBeLessThanOrEqual(14_000);
    expect(skippedMs).toBeGreaterThan(0);
  });

  it("updates far more often on a fast GPU", () => {
    const slow = run(2500);
    const fast = run(300);
    expect(fast.runs).toBeGreaterThan(slow.runs * 2);
  });
});
