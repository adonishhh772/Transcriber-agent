import { createAudioChunks } from "../audio/chunking";
import { resampleLinear, TARGET_SAMPLE_RATE } from "../audio/pcm";
import type { CaptureStreams } from "../capture/browserCapture";
import {
  mergeOverlappingTranscript,
  type TranscriptSegment,
} from "../transcript/dedup";
import { WhisperClient } from "./whisperClient";

export type TranscriptionSettings = {
  chunkDurationMs: number;
  overlapMs: number;
  silenceRmsThreshold: number;
  model: string;
  language: string;
};

export type TranscriptionCallbacks = {
  onState: (state: string) => void;
  onProgress: (progress: number, status: string) => void;
  onBackend: (backend: "webgpu" | "wasm") => void;
  onSegment: (segment: TranscriptSegment, all: TranscriptSegment[]) => void;
  onLag: (lagMs: number) => void;
  onError: (message: string) => void;
};

export class TranscriptionController {
  private readonly settings: TranscriptionSettings;
  private readonly callbacks: TranscriptionCallbacks;
  private readonly client: WhisperClient;
  private capture: CaptureStreams | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;
  private buffered = new Float32Array();
  private processedSamples = 0;
  private segments: TranscriptSegment[] = [];
  private paused = false;
  private stopped = false;

  constructor(
    settings: TranscriptionSettings,
    callbacks: TranscriptionCallbacks,
  ) {
    this.settings = settings;
    this.callbacks = callbacks;
    this.client = new WhisperClient({
      model: settings.model,
      onProgress: callbacks.onProgress,
      onBackend: callbacks.onBackend,
      onError: callbacks.onError,
      language: settings.language,
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
    this.buffered = new Float32Array();
    this.processedSamples = 0;
    this.client.dispose();
    this.segments = [];
    this.callbacks.onState("Stopped");
  }

  getSegments(): TranscriptSegment[] {
    return [...this.segments];
  }

  private handleAudio(input: Float32Array, sourceRate: number): void {
    if (this.paused || this.stopped) return;
    const mono16k = resampleLinear(input, sourceRate, TARGET_SAMPLE_RATE);
    const merged = new Float32Array(this.buffered.length + mono16k.length);
    merged.set(this.buffered);
    merged.set(mono16k, this.buffered.length);
    const chunkSamples = Math.round(
      (TARGET_SAMPLE_RATE * this.settings.chunkDurationMs) / 1000,
    );
    const overlapSamples = Math.round(
      (TARGET_SAMPLE_RATE * this.settings.overlapMs) / 1000,
    );
    const chunks = createAudioChunks(merged, {
      sampleRate: TARGET_SAMPLE_RATE,
      chunkDurationMs: this.settings.chunkDurationMs,
      overlapMs: this.settings.overlapMs,
      silenceRmsThreshold: this.settings.silenceRmsThreshold,
    });

    if (chunks.length === 0 || merged.length < chunkSamples) {
      this.buffered = merged;
      return;
    }

    const keepFrom = Math.max(0, merged.length - overlapSamples);
    this.buffered = merged.slice(keepFrom);
    for (const chunk of chunks.slice(0, -1)) {
      const absoluteStart = Math.round(
        ((this.processedSamples + (chunk.startMs * TARGET_SAMPLE_RATE) / 1000) *
          1000) /
          TARGET_SAMPLE_RATE,
      );
      const absoluteEnd = Math.round(
        ((this.processedSamples + (chunk.endMs * TARGET_SAMPLE_RATE) / 1000) *
          1000) /
          TARGET_SAMPLE_RATE,
      );
      void this.enqueueChunk(chunk.samples, absoluteStart, absoluteEnd);
    }
    this.processedSamples += Math.max(0, merged.length - overlapSamples);
  }

  private async enqueueChunk(
    samples: Float32Array,
    startMs: number,
    endMs: number,
  ): Promise<void> {
    const started = performance.now();
    try {
      const segment = await this.client.transcribe(samples, startMs, endMs);
      this.callbacks.onLag(Math.max(0, performance.now() - started));
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
    }
  }
}
