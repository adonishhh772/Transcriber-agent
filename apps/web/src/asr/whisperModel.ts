/**
 * Whisper capability helpers.
 *
 * Whisper checkpoints come in two flavours:
 *   - multilingual (e.g. `Xenova/whisper-tiny`), which need a `<|lang|>` and a
 *     task token as the first decoder tokens;
 *   - English-only (`*.en`, e.g. `Xenova/whisper-tiny.en`), which have neither
 *     token, so transformers.js refuses a `language`/`task` generate option:
 *
 *       "Cannot specify `task` or `language` for an English-only model. If the
 *        model is intended to be multilingual, pass `is_multilingual=true` to
 *        generate, or update the generation config."
 *
 * The model's own `is_multilingual` flag (read from `generation_config.json`)
 * is authoritative; the checkpoint id is only a fallback for older/offline
 * loads where that file was not fetched.
 */

export type WhisperConfigLike =
  | { is_multilingual?: unknown }
  | null
  | undefined;

export type WhisperModelLike =
  | {
      generation_config?: WhisperConfigLike;
      config?: WhisperConfigLike;
    }
  | null
  | undefined;

/** True when the checkpoint id names an English-only Whisper model (`*.en`). */
export function isEnglishOnlyModelId(modelId: string): boolean {
  const last = (modelId ?? "").trim().split("/").pop() ?? "";
  return /\.en$/i.test(last);
}

/**
 * Whether the loaded model accepts the `language`/`task` generate options.
 * Falls back to the checkpoint id when the model does not expose the flag.
 */
export function modelAcceptsLanguageOption(
  model: WhisperModelLike,
  modelId: string,
): boolean {
  const flag =
    model?.generation_config?.is_multilingual ??
    model?.config?.is_multilingual;
  if (typeof flag === "boolean") return flag;
  return !isEnglishOnlyModelId(modelId);
}

export type WhisperChunkOptions = {
  return_timestamps: true;
  chunk_length_s: number;
  max_new_tokens: number;
  language?: string;
  task?: "transcribe";
};

/**
 * Token budget for one window.
 *
 * Whisper can fall into a timestamp loop on quiet or noisy audio and keep
 * decoding until its 448-token limit: on WebGPU that turned a 2.5s window into
 * 30s+ of work which blocked every later window. Speech needs roughly two
 * tokens per word, so a few tokens per second of audio is generous.
 */
export function maxTokensForWindow(audioSeconds: number): number {
  return Math.max(32, Math.round(audioSeconds * 8));
}

/**
 * Builds the transformers.js pipeline options for one audio chunk.
 * `language` and `task` are only sent when the model can accept them, which is
 * what keeps English-only checkpoints working.
 */
export function buildWhisperChunkOptions(input: {
  audioSeconds: number;
  language?: string;
  acceptsLanguage: boolean;
}): WhisperChunkOptions {
  const options: WhisperChunkOptions = {
    return_timestamps: true,
    chunk_length_s: Math.max(1, input.audioSeconds),
    max_new_tokens: maxTokensForWindow(input.audioSeconds),
  };
  const language = input.language?.trim();
  if (language && input.acceptsLanguage) {
    options.language = language;
    options.task = "transcribe";
  }
  return options;
}
