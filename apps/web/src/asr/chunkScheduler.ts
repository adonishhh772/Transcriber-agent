/**
 * Chunk scheduling for live in-browser transcription.
 *
 * Whisper always encodes a padded 30-second window, so one inference costs
 * roughly the same for a 2-second clip as for a 6-second one. What actually
 * decides how "live" the transcript feels is therefore the cadence: how much
 * audio each pass advances past.
 *
 * Rules encoded here:
 *  - the first pass (and the first pass after silence) uses a short window so
 *    text appears after a couple of seconds instead of a full one;
 *  - the hop follows the measured inference time, so a slow device widens it
 *    (fewer, longer strides) instead of falling further and further behind,
 *    while a fast GPU narrows it for near-continuous updates;
 *  - the hop never exceeds `window - minOverlapMs`, so widening it still covers
 *    every sample of audio rather than skipping words;
 *  - if the device cannot keep up even then, stale audio is skipped instead of
 *    being transcribed minutes late.
 */

export type ChunkSchedulerConfig = {
  sampleRate: number;
  /** Nominal window length in milliseconds. */
  chunkMs: number;
  /** Nominal overlap between consecutive windows. */
  overlapMs: number;
  /** Window used for the first pass and immediately after silence. */
  firstChunkMs?: number;
  /** The hop never drops below this. */
  minHopMs?: number;
  /** Overlap kept even when the hop is widened to keep up. */
  minOverlapMs?: number;
  /** Share of the hop that a single inference is allowed to occupy. */
  targetDuty?: number;
  /** How many inferences may run at the same time. */
  maxInFlight?: number;
};

export type ResolvedScheduler = Required<
  Omit<ChunkSchedulerConfig, "sampleRate">
> & { sampleRate: number };

export type ChunkPlanInput = {
  /** Absolute sample index one past the last captured sample. */
  availableSample: number;
  /** Absolute sample index the next window would start at. */
  consumedSample: number;
  /** First pass, or the previous window held no speech. */
  preferShortChunk: boolean;
  /** Measured duration of the previous inference (0 when unknown). */
  lastInferenceMs: number;
  inFlight: number;
};

export type ChunkPlan =
  | { action: "wait" }
  | {
      action: "run";
      startSample: number;
      endSample: number;
      nextSample: number;
    }
  | { action: "skip"; nextSample: number; droppedMs: number };

export function resolveScheduler(
  config: ChunkSchedulerConfig,
): ResolvedScheduler {
  const chunkMs = Math.max(1, config.chunkMs);
  const overlapMs = Math.max(0, Math.min(config.overlapMs, chunkMs));
  const minOverlapMs = Math.max(
    0,
    Math.min(config.minOverlapMs ?? 250, chunkMs - 1),
  );
  return {
    sampleRate: config.sampleRate,
    chunkMs,
    overlapMs,
    firstChunkMs: Math.max(
      250,
      Math.min(config.firstChunkMs ?? 2500, chunkMs),
    ),
    minOverlapMs,
    minHopMs: Math.max(
      1,
      Math.min(config.minHopMs ?? 1200, chunkMs - minOverlapMs),
    ),
    targetDuty: Math.min(0.95, Math.max(0.2, config.targetDuty ?? 0.65)),
    maxInFlight: Math.max(1, Math.floor(config.maxInFlight ?? 1)),
  };
}

export function msToSamples(ms: number, sampleRate: number): number {
  return Math.max(0, Math.round((ms * sampleRate) / 1000));
}

/** Window length for this pass, honouring the short-chunk cases. */
export function windowMsFor(
  input: Pick<ChunkPlanInput, "preferShortChunk">,
  scheduler: ResolvedScheduler,
): number {
  return input.preferShortChunk
    ? Math.min(scheduler.firstChunkMs, scheduler.chunkMs)
    : scheduler.chunkMs;
}

/** Stride between consecutive windows, adapted to the measured inference time. */
export function hopMsFor(
  input: Pick<ChunkPlanInput, "lastInferenceMs" | "preferShortChunk">,
  scheduler: ResolvedScheduler,
): number {
  const windowMs = windowMsFor(input, scheduler);
  const maxHopMs = Math.max(1, windowMs - scheduler.minOverlapMs);
  const minHopMs = Math.min(scheduler.minHopMs, maxHopMs);
  const measured =
    input.lastInferenceMs > 0
      ? input.lastInferenceMs / scheduler.targetDuty
      : Math.max(0, windowMs - scheduler.overlapMs);
  return Math.max(minHopMs, Math.min(maxHopMs, measured));
}

export function planChunk(
  input: ChunkPlanInput,
  scheduler: ResolvedScheduler,
): ChunkPlan {
  const { sampleRate } = scheduler;
  const windowSamples = msToSamples(windowMsFor(input, scheduler), sampleRate);
  const hopSamples = msToSamples(hopMsFor(input, scheduler), sampleRate);
  const available = input.availableSample - input.consumedSample;

  if (available < windowSamples) return { action: "wait" };

  if (input.inFlight >= scheduler.maxInFlight) {
    /* Keep at most one window of backlog: past that, the audio is already too
       old to be worth transcribing, so move the window up to the live edge. */
    const backlogLimit = windowSamples + hopSamples;
    if (available > backlogLimit) {
      const nextSample = input.availableSample - windowSamples;
      return {
        action: "skip",
        nextSample,
        droppedMs: Math.round(
          ((nextSample - input.consumedSample) * 1000) / sampleRate,
        ),
      };
    }
    return { action: "wait" };
  }

  return {
    action: "run",
    startSample: input.consumedSample,
    endSample: input.consumedSample + windowSamples,
    nextSample: input.consumedSample + hopSamples,
  };
}
