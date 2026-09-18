/**
 * Questions about one finished meeting.
 *
 * The answer has to come from this meeting alone — the transcript, the notes
 * the model already produced, and what the shared screen showed — so the prompt
 * carries that material and nothing else. A meeting assistant that invents a
 * decision nobody made is worse than no answer at all.
 */

import { formatClock, type IntelligenceResult } from "./notes";

export const ASK_SYSTEM_PROMPT =
  "You answer questions about one specific meeting. The transcript is the record " +
  "of what was said and is your primary source: read all of it before answering, " +
  "including the parts that are not mentioned in the notes. The notes are a " +
  "summary written earlier and may be incomplete or out of date — use them as a " +
  "guide, and where they disagree with the transcript, follow the transcript. If " +
  "the material does not contain the answer, say so plainly and say what is " +
  "missing — never guess, and never invent decisions, owners, dates or numbers. " +
  "Answer in plain prose, at most three short paragraphs, and quote the wording " +
  "of the meeting when it matters. Do not add a summary of the meeting unless the " +
  "question asks for one.";

export type AskScreenNote = { atMs: number; text: string };

export type AskContext = {
  transcript: string;
  notes?: IntelligenceResult | null;
  screenNotes?: AskScreenNote[];
};

export type AskTurn = { question: string; answer: string };

/** How many earlier turns are carried into a follow-up question. */
export const ASK_HISTORY_TURNS = 4;

/** Everything the model is allowed to use, laid out for a single question. */
export function buildAskPrompt(
  context: AskContext,
  question: string,
  history: AskTurn[] = [],
): string {
  const sections: string[] = [];
  const asked = question.trim();
  if (!asked) throw new Error("Type a question first.");

  /* The transcript leads on purpose: it is the whole record, and a model reads
     what it is given first with the most attention. */
  const transcript = context.transcript.trim();
  if (transcript) sections.push("Transcript of the meeting (the record):", transcript);

  const notes = context.notes;
  if (notes && hasNotesContent(notes)) {
    sections.push(
      "",
      "Notes written earlier from this transcript (a guide only, possibly incomplete):",
      JSON.stringify({
        executiveSummary: notes.executiveSummary,
        keyPoints: notes.keyPoints,
        decisions: notes.decisions,
        actionItems: notes.actionItems,
        questions: notes.questions,
      }),
    );
  }

  const screenNotes = context.screenNotes ?? [];
  if (screenNotes.length) {
    sections.push(
      "",
      "What was on the shared screen, in order:",
      ...screenNotes.map((note) => `- ${formatClock(note.atMs)}: ${note.text}`),
    );
  }

  const recent = history.slice(-ASK_HISTORY_TURNS);
  if (recent.length) {
    sections.push(
      "",
      "Earlier questions in this meeting (most recent last):",
      ...recent.map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`),
    );
  }

  return [
    "Material for this meeting:",
    sections.length ? sections.join("\n") : "(nothing was recorded)",
    "",
    `Question: ${asked}`,
  ].join("\n");
}

function hasNotesContent(notes: IntelligenceResult): boolean {
  return Boolean(
    notes.executiveSummary.trim() ||
      notes.keyPoints.length ||
      notes.decisions.length ||
      notes.actionItems.length ||
      notes.questions.length,
  );
}
