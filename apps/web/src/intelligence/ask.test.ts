import { describe, expect, it } from "vitest";
import { ASK_HISTORY_TURNS, buildAskPrompt } from "./ask";
import { EMPTY_RESULT } from "./notes";

const context = {
  transcript: "Priya: we ship the notes screen on Friday.",
  notes: {
    ...EMPTY_RESULT,
    executiveSummary: "The notes screen ships on Friday.",
    decisions: ["Ship on Friday"],
  },
  screenNotes: [{ atMs: 25_000, text: "Roadmap slide: Q3 marked done." }],
};

describe("buildAskPrompt", () => {
  it("carries the transcript, the notes and the screen in one prompt", () => {
    const prompt = buildAskPrompt(context, "When do we ship?");
    expect(prompt).toContain("Priya: we ship the notes screen on Friday.");
    expect(prompt).toContain("The notes screen ships on Friday.");
    expect(prompt).toContain("Ship on Friday");
    expect(prompt).toContain("- 00:25: Roadmap slide: Q3 marked done.");
    expect(prompt.endsWith("Question: When do we ship?")).toBe(true);
  });

  it("trims the question and refuses an empty one", () => {
    expect(buildAskPrompt(context, "  Who owns it?  ")).toContain(
      "Question: Who owns it?",
    );
    expect(() => buildAskPrompt(context, "   ")).toThrow(/Type a question/);
  });

  it("keeps only the most recent turns of the conversation", () => {
    const history = Array.from({ length: ASK_HISTORY_TURNS + 2 }, (_, index) => ({
      question: `question ${index}`,
      answer: `answer ${index}`,
    }));
    const prompt = buildAskPrompt(context, "and then?", history);
    expect(prompt).not.toContain("question 0");
    expect(prompt).not.toContain("question 1");
    expect(prompt).toContain(`question ${ASK_HISTORY_TURNS + 1}`);
  });

  it("says so when a meeting recorded nothing", () => {
    const prompt = buildAskPrompt({ transcript: "" }, "What happened?");
    expect(prompt).toContain("(nothing was recorded)");
    expect(prompt).not.toContain("Transcript:");
  });

  it("leaves out sections that have no content", () => {
    const prompt = buildAskPrompt(
      { transcript: "Only words.", notes: { ...EMPTY_RESULT } },
      "Anything?",
    );
    expect(prompt).toContain("Transcript:");
    expect(prompt).not.toContain("Meeting notes already written");
    expect(prompt).not.toContain("shared screen");
  });
});
