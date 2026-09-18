import { describe, expect, it } from "vitest";
import { exportMarkdown } from "./intelligence";

const BASE = {
  title: "Probe meeting",
  transcript: [
    { text: "We ship on Friday.", startMs: 5_000, endMs: 9_000 },
  ],
  manualNotes: "Ask about the budget.",
  generatedNotes: {},
  summary: {
    executiveSummary: "The notes screen ships on Friday.",
    keyPoints: ["Scope frozen"],
    decisions: ["Ship on Friday"],
    actionItems: [{ description: "Send the deck", owner: "Priya" }],
    questions: ["Who owns launch?"],
  },
};

describe("exportMarkdown", () => {
  it("carries the screen, the questions and the AI changelog", () => {
    const markdown = exportMarkdown({
      ...BASE,
      screenNotes: [{ atMs: 25_000, text: "Roadmap slide: Q3 marked done." }],
      qa: [
        {
          atMs: 600_000,
          question: "Who owns the launch checklist?",
          answer: "Priya owns the launch checklist (00:12).",
        },
      ],
      aiActivity: [
        { atMs: 25_000, kind: "screen", text: "Roadmap slide: Q3 marked done." },
        { atMs: 30_000, kind: "notes", text: "Summary written · 2 new key points" },
        { atMs: 61_000, kind: "question", text: "Who owns the launch checklist?" },
      ],
    });

    expect(markdown).toContain("## Shared screen");
    expect(markdown).toContain("- [00:25] Roadmap slide: Q3 marked done.");
    expect(markdown).toContain("## Questions asked");
    expect(markdown).toContain("**Who owns the launch checklist?**");
    expect(markdown).toContain("Priya owns the launch checklist (00:12).");
    expect(markdown).toContain("## What the AI changed");
    expect(markdown).toContain(
      "- [00:30] Notes updated: Summary written · 2 new key points",
    );
    expect(markdown).toContain(
      "- [01:01] Question: Who owns the launch checklist?",
    );
    /* The notes themselves are still exported exactly as before. */
    expect(markdown).toContain("- Priya — Send the deck");
    expect(markdown).toContain("## Transcript");
    expect(markdown.indexOf("## Shared screen")).toBeLessThan(
      markdown.indexOf("## Personal notes"),
    );
    /* The transcript is the long tail, so it stays last. */
    expect(markdown.indexOf("## Transcript")).toBeGreaterThan(
      markdown.indexOf("## What the AI changed"),
    );
  });

  it("says so when a meeting has none of them", () => {
    const markdown = exportMarkdown({ ...BASE, generatedNotes: BASE.summary });
    expect(markdown).toContain("Nothing was read from a shared screen.");
    expect(markdown).toContain("## Questions asked\nNone.");
    expect(markdown).toContain(
      "The AI did not run during this meeting.",
    );
  });

  it("exports meetings recorded before those fields existed", () => {
    const markdown = exportMarkdown({
      title: "Old meeting",
      transcript: [],
      manualNotes: "",
      generatedNotes: {},
      summary: null,
    });
    expect(markdown).toContain("# Old meeting");
    expect(markdown).toContain("## What the AI changed");
  });
});
