import { describe, expect, it } from "vitest";
import { describeNotesChange, notesShape } from "./activity";
import { EMPTY_RESULT, type IntelligenceResult } from "./notes";

function notes(overrides: Partial<IntelligenceResult> = {}): IntelligenceResult {
  return { ...EMPTY_RESULT, ...overrides };
}

describe("describeNotesChange", () => {
  it("reports the first pass as written, with the points it added", () => {
    expect(
      describeNotesChange(
        null,
        notes({
          executiveSummary: "We narrowed scope.",
          keyPoints: ["Scope frozen"],
        }),
      ),
    ).toBe("Summary written · 1 new key point");
  });

  it("separates a rewrite from a first write", () => {
    const previous = notes({ executiveSummary: "We shipped on Friday." });
    expect(
      describeNotesChange(previous, notes({ executiveSummary: "We delayed." })),
    ).toBe("Summary rewritten");
  });

  it("says nothing when nothing changed", () => {
    const previous = notes({
      executiveSummary: "We shipped.",
      keyPoints: ["Scope frozen"],
      decisions: ["Ship on Friday"],
    });
    expect(describeNotesChange(previous, previous)).toBeNull();
  });

  it("ignores case, punctuation and spacing", () => {
    const previous = notes({ executiveSummary: "We shipped it." });
    const next = notes({ executiveSummary: "  we shipped   it  " });
    expect(describeNotesChange(previous, next)).toBeNull();
  });

  it("counts dropped and added rows per section, in any order", () => {
    const previous = notes({
      keyPoints: ["Alpha", "Beta"],
      decisions: ["Freeze scope"],
      questions: ["Who owns launch?"],
    });
    const next = notes({
      keyPoints: ["Beta", "Alpha", "Gamma"],
      decisions: [],
      questions: ["Who owns launch?"],
    });
    expect(describeNotesChange(previous, next)).toBe(
      "1 new key point · 1 decision dropped",
    );
  });

  it("treats an owner change on an action item as a change", () => {
    const previous = notes({
      actionItems: [{ description: "Send the deck" }],
    });
    const next = notes({
      actionItems: [{ description: "Send the deck", owner: "Priya" }],
    });
    expect(describeNotesChange(previous, next)).toBe(
      "1 new action item · 1 action item dropped",
    );
  });

  it("reports an empty first pass as no change at all", () => {
    expect(describeNotesChange(null, notes())).toBeNull();
  });
});

describe("notesShape", () => {
  it("summarises what the notes contain", () => {
    expect(
      notesShape(
        notes({
          keyPoints: ["a", "b"],
          decisions: ["d"],
          actionItems: [{ description: "x" }],
        }),
      ),
    ).toBe("unchanged · 2 key points, 1 decision, 1 action item");
  });

  it("handles notes with nothing in them", () => {
    expect(notesShape(notes())).toBe("nothing to record");
  });
});
