/**
 * Deepgram-backed meeting transcriber.
 *
 * Taps the same mixed capture stream the local engine uses and forwards 100 ms
 * frames of 16 kHz PCM to Deepgram, which returns interim words almost
 * immediately and a final segment shortly after each utterance. Final segments
 * go through the same callback the local engine uses, so dedupe, notes,
 * history and export need no changes.
 */

import { resampleLinear, TARGET_SAMPLE_RATE } from "../audio/pcm";
import type { CaptureStreams } from "../capture/browserCapture";
import {
  mergeOverlappingTranscript,
  type TranscriptSegment,
} from "../transcript/dedup";
import { DeepgramStreamingClient } from "./deepgramClient";
import type { MeetingCallbacks, MeetingTranscriber } from "./types";

export type DeepgramControllerOptions = {
  apiKey: string;
  model: string;
  language: string;
};

/** 100 ms at 16 kHz: small enough for low latency, large enough to be cheap. */
const FRAME_SAMPLES = 1_600;

export class DeepgramController implements MeetingTranscriber {
  private readonly callbacks: MeetingCallbacks;
  private client: DeepgramStreamingClient | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private pending = new Float32Array(0);
  private segments: TranscriptSegment[] = [];
  private paused = false;
  private stopped = false;
  /** Set once the engine has told the caller it cannot continue. */
  private failed = false;

  constructor(
    private readonly options: DeepgramControllerOptions,
    callbacks: MeetingCallbacks,
  ) {
    this.callbacks = callbacks;
  }

  async start(capture: CaptureStreams): Promise<void> {
    this.stopped = false;
    this.paused = false;
    this.failed = false;
    this.callbacks.onState("Connecting to Deepgram…");

    const client = new DeepgramStreamingClient({
      apiKey: this.options.apiKey,
      model: this.options.model,
      language: this.options.language,
      sampleRate: TARGET_SAMPLE_RATE,
      onInterim: (text) => this.callbacks.onInterim?.(text),
      onFinal: (segment) => this.accept(segment),
      onStatus: (status, detail) => {
        if (this.stopped) return;
        if (status === "open") this.callbacks.onState("Listening (Deepgram)");
        if (status === "reconnecting")
          this.callbacks.onState(
            `Reconnecting to Deepgram…${detail ? ` (${detail})` : ""}`,
          );
      },
      onError: (message) => this.failOnce(message),
    });

    try {
      await client.connect();
    } catch (error) {
      this.failed = true;
      this.callbacks.onFatal?.(
        error instanceof Error ? error.message : "Deepgram could not start.",
      );
      throw error;
    }
    if (this.stopped) {
      await client.close();
      return;
    }
    this.client = client;

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
    this.callbacks.onState("Listening (Deepgram)");
  }

  pause(): void {
    this.paused = true;
    this.callbacks.onState("Paused");
  }

  resume(): void {
    this.paused = false;
    this.callbacks.onState("Listening (Deepgram)");
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
    const client = this.client;
    this.client = null;
    if (client) await client.close();
    this.segments = [];
    this.callbacks.onState("Stopped");
  }

  getSegments(): TranscriptSegment[] {
    return [...this.segments];
  }

  private handleAudio(input: Float32Array, sourceRate: number): void {
    if (this.paused || this.stopped || !this.client) return;
    const mono = resampleLinear(input, sourceRate, TARGET_SAMPLE_RATE);
    if (mono.length === 0) return;
    const merged = new Float32Array(this.pending.length + mono.length);
    merged.set(this.pending);
    merged.set(mono, this.pending.length);
    let offset = 0;
    while (merged.length - offset >= FRAME_SAMPLES) {
      this.client.send(merged.subarray(offset, offset + FRAME_SAMPLES));
      offset += FRAME_SAMPLES;
    }
    this.pending = merged.slice(offset);
  }

  private accept(segment: TranscriptSegment): void {
    if (this.stopped) return;
    const merged = mergeOverlappingTranscript(this.segments, segment);
    const newest = merged[merged.length - 1];
    this.segments = merged;
    this.callbacks.onLag(0);
    if (newest && newest !== this.segments[this.segments.length - 2])
      this.callbacks.onSegment(newest, this.segments);
  }

  /** Reports a terminal failure once, so the caller can fall back to local. */
  private failOnce(message: string): void {
    this.callbacks.onError(message);
    if (this.failed || this.stopped) return;
    this.failed = true;
    this.callbacks.onFatal?.(message);
  }
}
