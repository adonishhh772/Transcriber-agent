/**
 * Speech-to-text preferences.
 *
 * Separate from the AI-notes settings: this chooses how audio becomes text.
 * `local` runs Whisper in the browser and never uploads audio; `deepgram`
 * streams the mixed meeting audio to Deepgram for real-time results.
 */

import type { AsrProvider } from "./types";

const STORAGE_KEY = "gather.asr.v1";

export type AsrSettings = {
  provider: AsrProvider;
  /** Deepgram's key is stored by the shared key store (see settings.ts). */
  deepgramModel: string;
  language: string;
  /** Local Whisper model id. */
  localModel: string;
};

const DEFAULTS: AsrSettings = {
  provider: "deepgram",
  deepgramModel: "nova-3",
  language: "en",
  localModel: "Xenova/whisper-tiny.en",
};

export const DEEPGRAM_MODELS = ["nova-3", "nova-2", "nova-2-general"];

export const DEEPGRAM_LANGUAGES: Array<{ id: string; label: string }> = [
  { id: "en", label: "English" },
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "multi", label: "Multilingual / code-switching" },
];

export function loadAsrSettings(): AsrSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AsrSettings>;
    return {
      provider: parsed.provider === "local" ? "local" : "deepgram",
      deepgramModel: parsed.deepgramModel?.trim() || DEFAULTS.deepgramModel,
      language: parsed.language?.trim() || DEFAULTS.language,
      localModel: parsed.localModel?.trim() || DEFAULTS.localModel,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAsrSettings(settings: AsrSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private browsing: the choice simply does not persist */
  }
}

/**
 * Which engine a meeting will actually use.
 *
 * Local-only privacy mode always wins, and a cloud provider without a key
 * falls back to the local engine rather than failing to record.
 */
export function resolveAsrProvider(
  settings: AsrSettings,
  options: { localOnly: boolean; deepgramKey: string },
): AsrProvider {
  if (options.localOnly) return "local";
  if (settings.provider === "deepgram" && options.deepgramKey.trim())
    return "deepgram";
  return "local";
}

/** Why the cloud engine is not being used, for the settings copy. */
export function describeAsrProvider(
  settings: AsrSettings,
  options: { localOnly: boolean; deepgramKey: string },
): string {
  if (options.localOnly)
    return "Local-only mode is on: Whisper runs in this browser and no audio leaves the device.";
  if (settings.provider === "deepgram" && !options.deepgramKey.trim())
    return "Add a Deepgram API key to stream audio for real-time transcription. Until then Whisper runs locally.";
  if (settings.provider === "deepgram")
    return `Deepgram ${settings.deepgramModel} · audio is streamed to Deepgram while a meeting runs.`;
  return "Whisper runs in this browser: nothing is uploaded, updates arrive every few seconds.";
}
