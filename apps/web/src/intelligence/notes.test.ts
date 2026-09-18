import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  formatActionItem,
  hasNotes,
  normalizeResult,
  parseJsonLoose,
} from "./notes";

describe("parseJsonLoose", () => {
  it("parses bare JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON inside a code fence", () => {
    const text = 'Here are the notes:\n```json\n{"executiveSummary":"ok"}\n```';
    expect(parseJsonLoose(text)).toEqual({ executiveSummary: "ok" });
  });

  it("parses JSON surrounded by prose", () => {
    const text = 'Sure! {"keyPoints":["one"]} Let me know if you need more.';
    expect(parseJsonLoose(text)).toEqual({ keyPoints: ["one"] });
  });

  it("keeps braces that appear inside strings", () => {
    const text =
      '{"executiveSummary":"we used {braces} in text","decisions":[]}';
    expect(parseJsonLoose(text)).toEqual({
      executiveSummary: "we used {braces} in text",
      decisions: [],
    });
  });

  it("handles escaped quotes inside strings", () => {
    const text = '{"executiveSummary":"he said \\"ship it\\""}';
    expect(parseJsonLoose(text)).toEqual({
      executiveSummary: 'he said "ship it"',
    });
  });

  it("throws a helpful error when there is no JSON", () => {
    expect(() => parseJsonLoose("I could not summarise this meeting.")).toThrow(
      /did not return valid JSON/,
    );
  });
});

describe("normalizeResult", () => {
  it("reads the FastAPI response shape", () => {
    const result = normalizeResult({
      title: "Q3 roadmap review",
      executiveSummary: "We narrowed scope.",
      keyPoints: ["Scope frozen"],
      decisions: ["Freeze on Friday"],
      actionItems: [
        { owner: "Priya", description: "Rebuild the deck", dueDate: "Friday" },
      ],
      questions: ["Second reviewer?"],
    });
    expect(result.title).toBe("Q3 roadmap review");
    expect(result.keyPoints).toEqual(["Scope frozen"]);
    expect(result.decisions).toEqual(["Freeze on Friday"]);
    expect(result.actionItems).toEqual([
      { owner: "Priya", description: "Rebuild the deck", dueDate: "Friday" },
    ]);
    expect(result.questions).toEqual(["Second reviewer?"]);
  });

  it("accepts the snake_case rolling schema", () => {
    const result = normalizeResult({
      key_points: ["one", "two"],
      notes: "Short summary.",
      actions: [{ description: "Send the deck" }],
    });
    expect(result.keyPoints).toEqual(["one", "two"]);
    expect(result.executiveSummary).toBe("Short summary.");
    expect(result.actionItems).toEqual([{ description: "Send the deck" }]);
  });

  it("promotes plain-string action items", () => {
    expect(normalizeResult({ actionItems: ["Ship it"] }).actionItems).toEqual([
      { description: "Ship it" },
    ]);
  });

  it("survives missing, null and wrongly typed fields", () => {
    const result = normalizeResult({
      executiveSummary: null,
      keyPoints: "not an array",
      decisions: [1, "", "keep"],
      actionItems: [null, 5],
      questions: undefined,
    });
    expect(result.executiveSummary).toBe("");
    expect(result.keyPoints).toEqual([]);
    expect(result.decisions).toEqual(["1", "keep"]);
    expect(result.actionItems).toEqual([]);
    expect(result.questions).toEqual([]);
  });

  it("returns an empty result for non-objects", () => {
    expect(normalizeResult("nope").keyPoints).toEqual([]);
    expect(normalizeResult(undefined).executiveSummary).toBe("");
  });
});

describe("formatActionItem", () => {
  it("combines owner, due date and description", () => {
    expect(
      formatActionItem({
        owner: "Priya",
        dueDate: "Friday",
        description: "Rebuild the deck",
      }),
    ).toBe("Priya by Friday — Rebuild the deck");
  });

  it("falls back to the description alone", () => {
    expect(formatActionItem({ description: "Send notes" })).toBe("Send notes");
  });
});

describe("buildPrompt", () => {
  it("includes the transcript, schema and final-mode guidelines", () => {
    const prompt = buildPrompt("We agreed to ship on Friday.", true);
    expect(prompt).toContain("We agreed to ship on Friday.");
    expect(prompt).toContain("Full transcript");
    expect(prompt).toContain("executiveSummary");
    expect(prompt).toContain("Action items");
  });

  it("includes what the shared screen showed, with timestamps", () => {
    const prompt = buildPrompt("we agreed to ship on friday", true, [
      { atMs: 65_000, text: "Roadmap slide: three quarters, Q3 marked done." },
      { atMs: 130_000, text: "Budget table with twelve rows." },
    ]);
    expect(prompt).toContain("we agreed to ship on friday");
    expect(prompt).toContain("shared screen");
    expect(prompt).toContain("01:05: Roadmap slide: three quarters, Q3 marked done.");
    expect(prompt).toContain("02:10: Budget table with twelve rows.");
  });

  it("leaves the prompt untouched when nothing was on screen", () => {
    expect(buildPrompt("hello", false)).not.toContain("shared screen");
  });

  it("uses lighter guidelines for rolling notes", () => {
    const prompt = buildPrompt("Short window.", false);
    expect(prompt).toContain("Recent transcript");
    expect(prompt).toContain("4–8 key points maximum");
  });
});

describe("hasNotes", () => {
  it("detects whether anything was produced", () => {
    expect(hasNotes(normalizeResult({}))).toBe(false);
    expect(hasNotes(normalizeResult({ keyPoints: ["a"] }))).toBe(true);
  });
});
