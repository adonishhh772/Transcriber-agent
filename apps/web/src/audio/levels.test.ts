import { describe, expect, it } from "vitest";
import { levelPercent, rmsLevel } from "./levels";

describe("audio level utilities", () => {
  it("returns zero for an empty buffer", () => {
    expect(rmsLevel(new Float32Array())).toBe(0);
  });

  it("calculates RMS for a constant signal", () => {
    expect(rmsLevel(new Float32Array([0.5, 0.5, 0.5, 0.5]))).toBeCloseTo(0.5);
  });

  it("converts RMS to a bounded display percentage", () => {
    expect(levelPercent(0.42)).toBe(42);
    expect(levelPercent(-1)).toBe(0);
    expect(levelPercent(2)).toBe(100);
  });
});
