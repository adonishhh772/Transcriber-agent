export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  return Math.sqrt(sumSquares / samples.length);
}

export function levelPercent(rms: number): number {
  if (!Number.isFinite(rms)) return 0;
  return Math.max(0, Math.min(100, rms * 100));
}
