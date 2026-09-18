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

self.onmessage = async (event: MessageEvent<WhisperWorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === "load") {
      disposed = false;
      loadedModel = message.model;
      loadedBackend = message.backend;
      await loadWhisperRuntime(message.model, message.backend);
      post({ type: "loaded", model: loadedModel, backend: loadedBackend });
      return;
    }
    if (message.type === "transcribe") {
      if (!loadedModel || disposed)
        throw new Error("Whisper model is not loaded");
      const segment = await transcribeChunk(
        message.audio,
        message.startMs,
        message.endMs,
        message.language,
      );
      if (segment) post({ type: "segment", id: message.id, segment });
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
      id: "id" in message ? message.id : undefined,
    });
  }
};

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
