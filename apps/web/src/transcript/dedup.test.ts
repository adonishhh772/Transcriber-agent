import { describe, expect, it } from "vitest";
import { mergeOverlappingTranscript } from "./dedup";

describe("overlapping transcript deduplication", () => {
  it("removes repeated words at a chunk boundary", () => {
    const merged = mergeOverlappingTranscript(
      [{ text: "we will review the roadmap", startMs: 0, endMs: 4000 }],
      { text: "the roadmap tomorrow", startMs: 3000, endMs: 6000 },
    );
    expect(merged.map((segment) => segment.text)).toEqual([
      "we will review the roadmap",
      "tomorrow",
    ]);
  });

  it("does not add an identical overlapping segment", () => {
    const existing = [{ text: "hello team", startMs: 0, endMs: 3000 }];
    expect(
      mergeOverlappingTranscript(existing, {
        text: "hello team",
        startMs: 2000,
        endMs: 4000,
      }),
    ).toEqual(existing);
  });
});
