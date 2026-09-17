import { describe, expect, it } from "vitest";
import { interleavedToMono, resampleLinear } from "./pcm";

describe("PCM utilities", () => {
  it("resamples a signal to the requested length", () => {
    const result = resampleLinear(new Float32Array([0, 1, 0, -1]), 4, 2);
    expect(result.length).toBe(2);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0);
  });

  it("mixes interleaved channels to mono", () => {
    expect(
      Array.from(interleavedToMono(new Float32Array([1, -1, 0.5, 0.5]), 2)),
    ).toEqual([0, 0.5]);
  });
});
