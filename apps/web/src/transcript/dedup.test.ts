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

  /*
   * The notes passes record which lines they read as a range of indices into
   * this transcript, so a segment that was already stored must never change
   * position or text — otherwise every recorded range would quietly point at
   * the wrong words.
   */
  it("only ever appends: stored lines keep their index and their text", () => {
    let segments: ReturnType<typeof mergeOverlappingTranscript> = [];
    const incoming = [
      { text: "we will review the roadmap", startMs: 0, endMs: 4000 },
      { text: "the roadmap tomorrow", startMs: 3000, endMs: 6000 },
      { text: "the roadmap tomorrow", startMs: 5000, endMs: 7000 },
      { text: "Priya takes the deck", startMs: 7000, endMs: 9000 },
      { text: "Priya takes the deck and sends it", startMs: 8000, endMs: 11_000 },
    ];
    for (const segment of incoming) {
      const before = segments.map((item) => `${item.text}@${item.startMs}`);
      segments = mergeOverlappingTranscript(segments, segment);
      /* Everything already stored is still there, unchanged and in the same
         order, so an index recorded earlier still means the same words. */
      expect(
        segments
          .slice(0, before.length)
          .map((item) => `${item.text}@${item.startMs}`),
      ).toEqual(before);
    }
    expect(segments.length).toBeGreaterThan(1);
  });
});
