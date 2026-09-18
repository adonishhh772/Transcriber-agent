import { describe, expect, it } from "vitest";
import {
  buildWhisperChunkOptions,
  isEnglishOnlyModelId,
  modelAcceptsLanguageOption,
} from "./whisperModel";

describe("isEnglishOnlyModelId", () => {
  it("recognises `.en` checkpoints", () => {
    expect(isEnglishOnlyModelId("Xenova/whisper-tiny.en")).toBe(true);
    expect(isEnglishOnlyModelId("Xenova/whisper-base.en")).toBe(true);
    expect(isEnglishOnlyModelId("distil-whisper/distil-medium.en")).toBe(true);
    expect(isEnglishOnlyModelId("whisper-tiny.en")).toBe(true);
  });

  it("treats multilingual checkpoints as multilingual", () => {
    expect(isEnglishOnlyModelId("Xenova/whisper-tiny")).toBe(false);
    expect(isEnglishOnlyModelId("Xenova/whisper-base")).toBe(false);
    expect(
      isEnglishOnlyModelId("onnx-community/whisper-large-v3-turbo"),
    ).toBe(false);
    expect(isEnglishOnlyModelId("Xenova/whisper-small-en")).toBe(false);
    expect(isEnglishOnlyModelId("")).toBe(false);
  });
});

describe("modelAcceptsLanguageOption", () => {
  it("prefers the model's own is_multilingual flag", () => {
    expect(
      modelAcceptsLanguageOption(
        { generation_config: { is_multilingual: true } },
        "someone/custom-english.en",
      ),
    ).toBe(true);
    expect(
      modelAcceptsLanguageOption(
        { generation_config: { is_multilingual: false } },
        "someone/custom-multilingual",
      ),
    ).toBe(false);
  });

  it("falls back to config, then to the checkpoint id", () => {
    expect(
      modelAcceptsLanguageOption({ config: { is_multilingual: true } }, "x.en"),
    ).toBe(true);
    expect(modelAcceptsLanguageOption({ generation_config: {} }, "x.en")).toBe(
      false,
    );
    expect(modelAcceptsLanguageOption(null, "Xenova/whisper-tiny")).toBe(true);
    expect(modelAcceptsLanguageOption(undefined, "Xenova/whisper-tiny.en")).toBe(
      false,
    );
  });
});

describe("buildWhisperChunkOptions", () => {
  it("never sends language or task to an English-only model", () => {
    const options = buildWhisperChunkOptions({
      audioSeconds: 6,
      language: "en",
      acceptsLanguage: false,
    });
    expect(options).toEqual({ return_timestamps: true, chunk_length_s: 6 });
    expect("language" in options).toBe(false);
    expect("task" in options).toBe(false);
  });

  it("sends language and task for a multilingual model", () => {
    expect(
      buildWhisperChunkOptions({
        audioSeconds: 6,
        language: "en",
        acceptsLanguage: true,
      }),
    ).toEqual({
      return_timestamps: true,
      chunk_length_s: 6,
      language: "en",
      task: "transcribe",
    });
  });

  it("omits blank language hints", () => {
    const options = buildWhisperChunkOptions({
      audioSeconds: 6,
      language: "   ",
      acceptsLanguage: true,
    });
    expect("language" in options).toBe(false);
    expect("task" in options).toBe(false);
  });

  it("keeps chunk_length_s a valid positive number", () => {
    const options = buildWhisperChunkOptions({
      audioSeconds: 0,
      acceptsLanguage: false,
    });
    expect(options.chunk_length_s).toBe(1);
    expect(
      buildWhisperChunkOptions({ audioSeconds: 6.5, acceptsLanguage: false })
        .chunk_length_s,
    ).toBe(6.5);
  });
});
