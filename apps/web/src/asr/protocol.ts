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
  | { type: "segment"; id: number; segment: TranscriptSegment }
  | { type: "error"; message: string; id?: number }
  | { type: "disposed" };
