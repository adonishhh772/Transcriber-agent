import type { WhisperWorkerRequest, WhisperWorkerResponse } from "./protocol";
import {
  buildWhisperChunkOptions,
  modelAcceptsLanguageOption,
  type WhisperModelLike,
} from "./whisperModel";

let disposed = false;
let loadedModel = "";
let loadedBackend: "webgpu" | "wasm" = "wasm";
let pipeline: unknown = null;
/** Serialises inference: one pipeline, one generate() at a time. */
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<WhisperWorkerRequest>) => {
  const message = event.data;
  if (message.type === "transcribe") {
    /* Overlapping generate() calls on a single ONNX pipeline compete for the
       same decoder cache and CPU: they slow each other down instead of
       finishing sooner, so requests are chained. */
    queue = queue.then(() => runTranscribe(message));
    return;
  }
  void runControl(message);
};

async function runControl(
  message: Exclude<WhisperWorkerRequest, { type: "transcribe" }>,
): Promise<void> {
  try {
    if (message.type === "load") {
      disposed = false;
      loadedModel = message.model;
      loadedBackend = message.backend;
      await loadWhisperRuntime(message.model, message.backend);
      post({ type: "loaded", model: loadedModel, backend: loadedBackend });
      return;
    }
    if (message.type === "dispose") {
      disposed = true;
      loadedModel = "";
      pipeline = null;
      post({ type: "disposed" });
      self.close();
    }
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : "Whisper worker failed",
    });
  }
}

async function runTranscribe(
  message: Extract<WhisperWorkerRequest, { type: "transcribe" }>,
): Promise<void> {
  try {
    if (!loadedModel || disposed) throw new Error("Whisper model is not loaded");
    const started = Date.now();
    const segment = await transcribeChunk(
      message.audio,
      message.startMs,
      message.endMs,
      message.language,
    );
    post({ type: "timing", id: message.id, ms: Date.now() - started });
    /* Always answer, even for a window with no words: the caller is waiting on
       this id, and silence is the common case at the start of a meeting. */
    post({ type: "segment", id: message.id, segment });
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : "Whisper worker failed",
      id: message.id,
    });
  }
}

async function loadWhisperRuntime(
  model: string,
  backend: "webgpu" | "wasm",
): Promise<void> {
  const transformers = await import("@huggingface/transformers");
  const env = transformers.env;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const device = backend === "webgpu" ? "webgpu" : "wasm";
  pipeline = await transformers.pipeline(
    "automatic-speech-recognition",
    model,
    {
      device,
      dtype: backend === "webgpu" ? "q4" : "q8",
      progress_callback: (event: { progress?: number; status?: string }) => {
        post({
          type: "progress",
          progress: Math.round(event.progress ?? 0),
          status: event.status ?? `Loading ${model}`,
        });
      },
    },
  );
}

async function transcribeChunk(
  audio: Float32Array,
  startMs: number,
  endMs: number,
  language: string,
) {
  if (!pipeline || disposed) return null;
  // English-only checkpoints (`*.en`) reject `language`/`task`, so only send
  // them when the loaded model actually supports them.
  const options = buildWhisperChunkOptions({
    audioSeconds: (endMs - startMs) / 1000,
    language,
    acceptsLanguage: modelAcceptsLanguageOption(
      (pipeline as { model?: WhisperModelLike }).model,
      loadedModel,
    ),
  });
  const result = await (
    pipeline as (
      audio: Float32Array,
      options: Record<string, unknown>,
    ) => Promise<{
      text?: string;
      chunks?: Array<{ text?: string; timestamp?: [number, number] }>;
    }>
  )(audio, options);
  const text = (result.text ?? "").trim();
  if (!text) return null;
  const first = result.chunks?.[0]?.timestamp?.[0] ?? 0;
  const last =
    result.chunks?.[result.chunks.length - 1]?.timestamp?.[1] ??
    (endMs - startMs) / 1000;
  return {
    text,
    startMs: startMs + Math.round(first * 1000),
    endMs: startMs + Math.round(last * 1000),
  };
}

function post(message: WhisperWorkerResponse): void {
  self.postMessage(message);
}
