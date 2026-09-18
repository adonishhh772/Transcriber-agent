/**
 * Shared shape for anything that turns a live meeting into transcript
 * segments: the local Whisper controller and the Deepgram streaming
 * controller are interchangeable behind this interface.
 */

import type { CaptureStreams } from "../capture/browserCapture";
import type { TranscriptSegment } from "../transcript/dedup";

export type AsrProvider = "local" | "deepgram";

export type MeetingCallbacks = {
  onState: (state: string) => void;
  onSegment: (segment: TranscriptSegment, all: TranscriptSegment[]) => void;
  onLag: (lagMs: number) => void;
  onError: (message: string) => void;
  /** Live, not-yet-final words (cloud streaming only). */
  onInterim?: (text: string) => void;
  /** Local engine only: level and window counters. */
  onDiagnostics?: (snapshot: unknown) => void;
  /** The engine cannot continue — the caller should fall back to local. */
  onFatal?: (message: string) => void;
};

export interface MeetingTranscriber {
  start(capture: CaptureStreams): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  getSegments(): TranscriptSegment[];
}
