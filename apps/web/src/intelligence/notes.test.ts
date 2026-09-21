import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  describeNotesSource,
  formatActionItem,
  hasNotes,
  normalizeResult,
  notesSourceText,
  parseJsonLoose,
  sourceLines,
  type NotesSource,
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

describe("what a note section was written from", () => {
  /** Four lines, of which the rolling pass below read the last two. */
  const transcript = [
    { atMs: 0, text: "Kick-off." },
    { atMs: 60_000, text: "Scope talk." },
    { atMs: 120_000, text: "We will freeze scope on Friday." },
    { atMs: 124_000, text: "Priya takes the deck." },
  ];
  const rolling: NotesSource = {
    atMs: 125_000,
    final: false,
    model: "DeepSeek · deepseek-chat",
    engine: "Deepgram",
    from: 2,
    to: 4,
    screenNotes: [{ atMs: 121_000, text: "Roadmap slide: Q3 marked done." }],
  };

  it("says which pass ran, over what, and with which model", () => {
    const described = describeNotesSource(rolling);
    expect(described).toContain("Rolling pass");
    expect(described).toContain("at 02:05");
    expect(described).toContain("2 transcript lines");
    expect(described).toContain("1 screen capture");
    expect(described).toContain("DeepSeek · deepseek-chat");
    expect(described).toContain("lines from Deepgram");
  });

  it("describes a single line in the singular", () => {
    expect(describeNotesSource({ ...rolling, to: 3 })).toContain(
      "1 transcript line ·",
    );
  });

  it("hands back the content itself, timestamped", () => {
    const text = notesSourceText(rolling, transcript);
    expect(text).toContain("[02:00] We will freeze scope on Friday.");
    expect(text).toContain("[02:04] Priya takes the deck.");
    expect(text).toContain("Shared screen:");
    expect(text).toContain("[02:01] Roadmap slide: Q3 marked done.");
  });

  it("reads only the lines its own range covers", () => {
    expect(sourceLines(rolling, transcript)).toEqual(transcript.slice(2));
    expect(notesSourceText(rolling, transcript)).not.toContain("Kick-off.");
    /* A rolling pass that happens to be the first one still says how many
       lines it read: "the whole transcript" belongs to the final pass. */
    const first: NotesSource = { ...rolling, from: 0 };
    expect(describeNotesSource(first)).toContain("4 transcript lines");
    expect(describeNotesSource(first)).not.toContain("the whole transcript");
  });

  it("reads the meeting's whole transcript for a pass that started at line 0", () => {
    const final: NotesSource = { ...rolling, final: true, from: 0, to: 4 };
    expect(sourceLines(final, transcript)).toEqual(transcript);
    expect(notesSourceText(final, transcript)).toContain("[00:00] Kick-off.");
    expect(describeNotesSource(final)).toContain("the whole transcript");
  });

  it("says so when a pass ran before anything was transcribed", () => {
    const empty: NotesSource = {
      ...rolling,
      from: 0,
      to: 0,
      screenNotes: [],
    };
    expect(sourceLines(empty, [])).toEqual([]);
    expect(notesSourceText(empty, [])).toContain(
      "Nothing had been transcribed yet.",
    );
  });
});
