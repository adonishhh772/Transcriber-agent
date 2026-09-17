import { describe, expect, it } from "vitest";
import { exportMarkdown } from "../backend/intelligence";
import { MEETING_SCHEMA_VERSION } from "./db";

describe("meeting persistence contract", () => {
  it("exports transcript and notes as markdown without executing input", () => {
    const markdown = exportMarkdown({
      title: "<Planning>",
      transcript: [{ text: "Ship Friday", startMs: 1000, endMs: 2000 }],
      manualNotes: "Remember QA",
      generatedNotes: {},
      summary: {
        executiveSummary: "Ship the release.",
        keyPoints: ["Ship Friday"],
        actionItems: [],
      },
    });
    expect(markdown).toContain("# <Planning>");
    expect(markdown).toContain("Ship Friday");
    expect(markdown).toContain("Remember QA");
  });

  it("has an explicit schema version for future migrations", () => {
    expect(MEETING_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });
});
