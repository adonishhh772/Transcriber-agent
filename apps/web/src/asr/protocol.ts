import type { TranscriptSegment } from "../transcript/dedup";

export type WhisperBackend = "webgpu" | "wasm";

export type WhisperWorkerRequest =
  | { type: "load"; model: string; backend: WhisperBackend }
  | {
      type: "transcribe";
      id: number;
      audio: Float32Array;
      startMs: number;
      endMs: number;
      language: string;
    }
  | { type: "dispose" };

export type WhisperWorkerResponse =
  | { type: "backend"; backend: WhisperBackend }
  | { type: "progress"; progress: number; status: string }
  | { type: "loaded"; model: string; backend: WhisperBackend }
  /**
   * Always sent for a transcribe request, even when the window held no speech
   * (`segment: null`). A missing reply used to leave the caller waiting until
   * the watchdog fired, which stalled the whole transcript.
   */
  | { type: "segment"; id: number; segment: TranscriptSegment | null }
  /** How long the model itself took, reported separately from queue wait. */
  | { type: "timing"; id: number; ms: number }
  | { type: "error"; message: string; id?: number }
  | { type: "disposed" };
