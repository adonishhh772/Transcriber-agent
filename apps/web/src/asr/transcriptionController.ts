import { rmsLevel } from "../audio/levels";
import { resampleLinear, TARGET_SAMPLE_RATE } from "../audio/pcm";
import type { CaptureStreams } from "../capture/browserCapture";
import {
  mergeOverlappingTranscript,
  type TranscriptSegment,
} from "../transcript/dedup";
import { planChunk, resolveScheduler } from "./chunkScheduler";
import type { WhisperClient } from "./whisperClient";

export type TranscriptionSettings = {
  chunkDurationMs: number;
  overlapMs: number;
  silenceRmsThreshold: number;
  model: string;
  language: string;
};

export type TranscriptionCallbacks = {
  onState: (state: string) => void;
  onSegment: (segment: TranscriptSegment, all: TranscriptSegment[]) => void;
  onLag: (lagMs: number) => void;
  onError: (message: string) => void;
  /** Level/counter feedback, so a quiet or silent input is never invisible. */
  onDiagnostics?: (snapshot: TranscriptionDiagnostics) => void;
};

export type TranscriptionDiagnostics = {
  /** RMS of the most recent window (0 when nothing has been measured yet). */
  level: number;
  transcribed: number;
  skippedSilent: number;
  /** Consecutive milliseconds skipped as too quiet. */
  silentMs: number;
  /** How long the current inference has been running (0 when idle). */
  inFlightMs: number;
  /** Milliseconds since the last finished inference (0 before the first). */
  sinceInferenceMs: number;
  /** Total audio received from the capture graph, in milliseconds. */
  receivedMs: number;
};

/** Safety net so a stalled worker cannot grow the pending buffer forever. */
const MAX_PENDING_MS = 30_000;

/**
 * How long one window may take before it is abandoned and the model rebuilt.
 * Normal windows take 1-3s, so this only catches a genuine stall.
 */
const INFERENCE_WATCHDOG_MS = 20_000;

export class TranscriptionController {
  private readonly settings: TranscriptionSettings;
  private readonly callbacks: TranscriptionCallbacks;
  /** Swappable: a reload replaces it, so it cannot be readonly. */
  private client: WhisperClient;
  private readonly scheduler;
  private capture: CaptureStreams | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;
  /** Audio waiting to be transcribed, starting at `bufferStartSample`. */
  private pending = new Float32Array(0);
  private bufferStartSample = 0;
  private inferenceMs = 0;
  private inFlight = 0;
  private transcribedOnce = false;
  private preferShortChunk = true;
  private skippedMs = 0;
  private transcribedWindows = 0;
  private skippedSilentWindows = 0;
  private silentMs = 0;
  private lastLevel = 0;
  private inFlightSince: number | null = null;
  private lastInferenceAt = 0;
  private receivedSamples = 0;
  private lastReportedReceivedMs = -1;
  /** Invalidates results from an inference that was abandoned. */
  private attempt = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private segments: TranscriptSegment[] = [];
  private paused = false;
  private stopped = false;

  constructor(
    settings: TranscriptionSettings,
    callbacks: TranscriptionCallbacks,
    /** Loaded by the caller and kept warm between meetings. */
    client: WhisperClient,
  ) {
    this.settings = settings;
    this.callbacks = callbacks;
    this.client = client;
    this.scheduler = resolveScheduler({
      sampleRate: TARGET_SAMPLE_RATE,
      chunkMs: settings.chunkDurationMs,
      overlapMs: settings.overlapMs,
    });
  }

  async start(capture: CaptureStreams): Promise<void> {
    this.capture = capture;
    this.stopped = false;
    this.paused = false;
    this.callbacks.onState("Loading Whisper model…");
    await this.client.load();
    const context = capture.audioContext;
    this.source = context.createMediaStreamSource(capture.mixed);
    this.processor = context.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) =>
      this.handleAudio(event.inputBuffer.getChannelData(0), context.sampleRate);
    this.source.connect(this.processor);
    this.silentGain = context.createGain();
    this.silentGain.gain.value = 0;
    this.processor.connect(this.silentGain);
    this.silentGain.connect(context.destination);
    this.callbacks.onState("Transcribing locally");
  }

  pause(): void {
    this.paused = true;
    this.callbacks.onState("Paused");
  }

  resume(): void {
    this.paused = false;
    this.callbacks.onState("Transcribing locally");
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silentGain?.disconnect();
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    this.pending = new Float32Array(0);
    this.bufferStartSample = 0;
    this.inferenceMs = 0;
    this.inFlight = 0;
    this.transcribedOnce = false;
    this.preferShortChunk = true;
    this.skippedMs = 0;
    this.transcribedWindows = 0;
    this.skippedSilentWindows = 0;
    this.silentMs = 0;
    this.lastLevel = 0;
    this.inFlightSince = null;
    this.lastInferenceAt = 0;
    this.receivedSamples = 0;
    this.lastReportedReceivedMs = -1;
    this.attempt += 1;
    this.clearWatchdog();
    /* The client is owned by the caller: the model stays loaded for the next
       meeting instead of being rebuilt every time. */
    this.segments = [];
    this.callbacks.onState("Stopped");
  }

  getSegments(): TranscriptSegment[] {
    return [...this.segments];
  }

  /** Milliseconds of audio dropped to stay close to real time. */
  getSkippedMs(): number {
    return this.skippedMs;
  }

  private handleAudio(input: Float32Array, sourceRate: number): void {
    if (this.paused || this.stopped) return;
    const mono16k = resampleLinear(input, sourceRate, TARGET_SAMPLE_RATE);
    if (mono16k.length === 0) return;
    this.receivedSamples += mono16k.length;
    const merged = new Float32Array(this.pending.length + mono16k.length);
    merged.set(this.pending);
    merged.set(mono16k, this.pending.length);
    this.pending = merged;
    this.trimOverflow();
    this.drain();
    /* Report the incoming audio even when no window is planned, so "the
       capture stopped" and "the planner is waiting" are distinguishable. */
    const receivedMs = Math.round(
      (this.receivedSamples * 1000) / TARGET_SAMPLE_RATE,
    );
    if (receivedMs - this.lastReportedReceivedMs >= 1000) {
      this.lastReportedReceivedMs = receivedMs;
      this.emitDiagnostics();
    }
  }

  /** Starts at most one inference per call; the next callback continues. */
  private drain(): void {
    for (let guard = 0; guard < 4; guard += 1) {
      const plan = planChunk(
        {
          availableSample: this.bufferStartSample + this.pending.length,
          consumedSample: this.bufferStartSample,
          preferShortChunk: this.preferShortChunk,
          lastInferenceMs: this.inferenceMs,
          inFlight: this.inFlight,
        },
        this.scheduler,
      );

      if (plan.action === "wait") return;

      if (plan.action === "skip") {
        this.skippedMs += plan.droppedMs;
        this.trimTo(plan.nextSample);
        this.preferShortChunk = true;
        continue;
      }

      const startOffset = plan.startSample - this.bufferStartSample;
      const chunk = this.pending.slice(
        startOffset,
        startOffset + (plan.endSample - plan.startSample),
      );
      this.trimTo(plan.nextSample);

      const level = rmsLevel(chunk);
      this.lastLevel = level;
      if (level < this.settings.silenceRmsThreshold) {
        /* Nothing audible: take the next window straight away and keep the
           short window so speech after the pause is picked up quickly. The
           counters are reported so a permanently quiet input is visible in the
           UI instead of looking like a frozen transcript. */
        this.preferShortChunk = true;
        this.skippedSilentWindows += 1;
        this.silentMs += Math.round(
          ((plan.endSample - plan.startSample) * 1000) / TARGET_SAMPLE_RATE,
        );
        this.emitDiagnostics();
        continue;
      }

      this.preferShortChunk = false;
      this.transcribedOnce = true;
      this.transcribedWindows += 1;
      this.silentMs = 0;
      this.inFlight += 1;
      this.inFlightSince = performance.now();
      const attempt = (this.attempt += 1);
      this.armWatchdog(attempt);
      this.emitDiagnostics();
      void this.transcribeChunk(
        chunk,
        Math.round((plan.startSample * 1000) / TARGET_SAMPLE_RATE),
        Math.round((plan.endSample * 1000) / TARGET_SAMPLE_RATE),
        attempt,
      );
      return;
    }
  }

  /**
   * Abandons an inference that has not come back.
   *
   * WebGPU can stall indefinitely on a quiet window; because inferences are
   * serialised, one stall used to stop the transcript for the rest of the
   * meeting. The model is rebuilt and the pipeline carries on.
   */
  private armWatchdog(attempt: number): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      if (attempt !== this.attempt || this.inFlight === 0) return;
      const seconds = Math.max(
        1,
        Math.round((performance.now() - (this.inFlightSince ?? 0)) / 1000),
      );
      this.watchdog = null;
      this.attempt += 1;
      this.inFlight = 0;
      this.inFlightSince = null;
      this.emitDiagnostics();
      this.callbacks.onError(
        `The model stalled for ${seconds}s on one window (a known WebGPU problem with quiet audio). Rebuilding it; transcription continues.`,
      );
      void this.client
        .recover()
        .catch(() => undefined)
        .then(() => {
          this.inferenceMs = 0;
          this.emitDiagnostics();
        });
    }, INFERENCE_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private emitDiagnostics(): void {
    this.callbacks.onDiagnostics?.({
      level: this.lastLevel,
      transcribed: this.transcribedWindows,
      skippedSilent: this.skippedSilentWindows,
      silentMs: this.silentMs,
      inFlightMs:
        this.inFlightSince === null
          ? 0
          : Math.round(performance.now() - this.inFlightSince),
      sinceInferenceMs:
        this.lastInferenceAt === 0
          ? 0
          : Math.round(performance.now() - this.lastInferenceAt),
      receivedMs: Math.round(
        (this.receivedSamples * 1000) / TARGET_SAMPLE_RATE,
      ),
    });
  }

  private async transcribeChunk(
    samples: Float32Array,
    startMs: number,
    endMs: number,
    attempt: number,
  ): Promise<void> {
    const started = performance.now();
    try {
      const segment = await this.client.transcribe(samples, startMs, endMs);
      if (attempt !== this.attempt) return; // abandoned by the watchdog
      this.inferenceMs = performance.now() - started;
      this.callbacks.onLag(Math.round(this.inferenceMs));
      if (!segment || this.stopped) return;
      const merged = mergeOverlappingTranscript(this.segments, segment);
      const newest = merged[merged.length - 1];
      this.segments = merged;
      if (newest && newest !== this.segments[this.segments.length - 2])
        this.callbacks.onSegment(newest, this.segments);
    } catch (error) {
      if (attempt !== this.attempt) return;
      this.callbacks.onError(
        error instanceof Error ? error.message : "Transcription failed",
      );
    } finally {
      if (attempt === this.attempt) {
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.inFlightSince = this.inFlight > 0 ? this.inFlightSince : null;
        this.lastInferenceAt = performance.now();
        this.clearWatchdog();
        this.emitDiagnostics();
      }
    }
  }

  /**
   * Swaps in a freshly loaded model (used when the user reloads it, or when a
   * backend has to be abandoned mid-meeting).
   */
  setClient(client: WhisperClient): void {
    this.client = client;
    this.inferenceMs = 0;
    this.inFlight = 0;
    this.inFlightSince = null;
  }

  private trimTo(nextSample: number): void {
    const offset = Math.max(
      0,
      Math.min(nextSample - this.bufferStartSample, this.pending.length),
    );
    if (offset === 0) return;
    this.pending = this.pending.slice(offset);
    this.bufferStartSample += offset;
  }

  private trimOverflow(): void {
    const maxSamples = Math.round((TARGET_SAMPLE_RATE * MAX_PENDING_MS) / 1000);
    if (this.pending.length <= maxSamples) return;
    const drop = this.pending.length - maxSamples;
    this.skippedMs += Math.round((drop * 1000) / TARGET_SAMPLE_RATE);
    this.trimTo(this.bufferStartSample + drop);
  }
}
