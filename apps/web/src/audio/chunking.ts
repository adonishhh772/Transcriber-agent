import { rmsLevel } from "./levels";

export type AudioChunk = {
  samples: Float32Array;
  startMs: number;
  endMs: number;
};

export type ChunkerOptions = {
  sampleRate: number;
  chunkDurationMs: number;
  overlapMs: number;
  silenceRmsThreshold?: number;
};

export function createAudioChunks(
  input: Float32Array,
  options: ChunkerOptions,
): AudioChunk[] {
  const { sampleRate, chunkDurationMs, overlapMs } = options;
  const threshold = options.silenceRmsThreshold ?? 0.008;
  const chunkSamples = Math.max(
    1,
    Math.round((sampleRate * chunkDurationMs) / 1000),
  );
  const overlapSamples = Math.min(
    chunkSamples - 1,
    Math.max(0, Math.round((sampleRate * overlapMs) / 1000)),
  );
  const hopSamples = chunkSamples - overlapSamples;
  const chunks: AudioChunk[] = [];

  for (let start = 0; start < input.length; start += hopSamples) {
    const end = Math.min(input.length, start + chunkSamples);
    const samples = input.slice(start, end);
    if (samples.length < Math.max(1, Math.floor(chunkSamples * 0.25))) break;
    if (rmsLevel(samples) < threshold) continue;
    chunks.push({
      samples,
      startMs: Math.round((start * 1000) / sampleRate),
      endMs: Math.round((end * 1000) / sampleRate),
    });
    if (end === input.length) break;
  }
  return chunks;
}
