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
};

/** Safety net so a stalled worker cannot grow the pending buffer forever. */
const MAX_PENDING_MS = 30_000;

export class TranscriptionController {
  private readonly settings: TranscriptionSettings;
  private readonly callbacks: TranscriptionCallbacks;
  private readonly client: WhisperClient;
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
    const merged = new Float32Array(this.pending.length + mono16k.length);
    merged.set(this.pending);
    merged.set(mono16k, this.pending.length);
    this.pending = merged;
    this.trimOverflow();
    this.drain();
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

      if (rmsLevel(chunk) < this.settings.silenceRmsThreshold) {
        /* Nothing said: take the next window straight away and keep the short
           window so speech after the pause is picked up quickly. */
        this.preferShortChunk = true;
        continue;
      }

      this.preferShortChunk = false;
      this.transcribedOnce = true;
      this.inFlight += 1;
      void this.transcribeChunk(
        chunk,
        Math.round((plan.startSample * 1000) / TARGET_SAMPLE_RATE),
        Math.round((plan.endSample * 1000) / TARGET_SAMPLE_RATE),
      );
      return;
    }
  }

  private async transcribeChunk(
    samples: Float32Array,
    startMs: number,
    endMs: number,
  ): Promise<void> {
    const started = performance.now();
    try {
      const segment = await this.client.transcribe(samples, startMs, endMs);
      this.inferenceMs = performance.now() - started;
      this.callbacks.onLag(Math.round(this.inferenceMs));
      if (!segment || this.stopped) return;
      const merged = mergeOverlappingTranscript(this.segments, segment);
      const newest = merged[merged.length - 1];
      this.segments = merged;
      if (newest && newest !== this.segments[this.segments.length - 2])
        this.callbacks.onSegment(newest, this.segments);
    } catch (error) {
      this.callbacks.onError(
        error instanceof Error ? error.message : "Transcription failed",
      );
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1);
    }
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
