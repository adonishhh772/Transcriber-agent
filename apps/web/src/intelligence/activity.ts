/**
 * The AI activity log: what the model suggested, and when it changed.
 *
 * The notes panel only ever shows the current state, which makes it impossible
 * to tell whether the model is still working, whether a summary was rewritten,
 * or whether a point was dropped. Every AI update therefore appends one line
 * here, and the log is stored with the meeting.
 */

import { formatActionItem, type IntelligenceResult } from "./notes";

export type AiActivityKind =
  | "notes"
  | "final"
  | "screen"
  | "question"
  | "error";

export type AiActivityEntry = {
  /** Milliseconds since this meeting started. */
  atMs: number;
  kind: AiActivityKind;
  text: string;
  /**
   * Index into the meeting's notes passes for a row the AI wrote notes on.
   *
   * The line says what changed; the pass says what it was reading when it
   * decided, so a rewritten summary can be checked against the transcript lines
   * behind it instead of being taken on trust.
   */
  sourceIndex?: number;
};

export const ACTIVITY_LABELS: Record<AiActivityKind, string> = {
  notes: "Notes updated",
  final: "Final notes",
  screen: "Screen read",
  question: "Question",
  error: "AI error",
};

/** Comparison key: case, punctuation and spacing must not look like a change. */
function key(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addedAndRemoved(
  previous: string[],
  next: string[],
): { added: number; removed: number } {
  const before = new Set(previous.map(key).filter(Boolean));
  const after = new Set(next.map(key).filter(Boolean));
  let added = 0;
  let removed = 0;
  for (const item of after) if (!before.has(item)) added += 1;
  for (const item of before) if (!after.has(item)) removed += 1;
  return { added, removed };
}

function count(amount: number, singular: string, plural = `${singular}s`): string {
  return `${amount} ${amount === 1 ? singular : plural}`;
}

function listParts(
  previous: string[],
  next: string[],
  singular: string,
): string[] {
  const { added, removed } = addedAndRemoved(previous, next);
  const parts: string[] = [];
  if (added) parts.push(count(added, `new ${singular}`, `new ${singular}s`));
  if (removed) parts.push(`${count(removed, singular)} dropped`);
  return parts;
}

/**
 * One line describing how a set of notes differs from the previous set.
 *
 * Returns null when nothing meaningful changed, so the log never fills up with
 * "no change" rows while a meeting is quiet.
 */
export function describeNotesChange(
  previous: IntelligenceResult | null,
  next: IntelligenceResult,
): string | null {
  const parts: string[] = [];

  const beforeSummary = key(previous?.executiveSummary ?? "");
  const afterSummary = key(next.executiveSummary);
  if (afterSummary && afterSummary !== beforeSummary)
    parts.push(beforeSummary ? "summary rewritten" : "summary written");

  parts.push(
    ...listParts(previous?.keyPoints ?? [], next.keyPoints, "key point"),
    ...listParts(previous?.decisions ?? [], next.decisions, "decision"),
    ...listParts(
      (previous?.actionItems ?? []).map(formatActionItem),
      next.actionItems.map(formatActionItem),
      "action item",
    ),
    ...listParts(previous?.questions ?? [], next.questions, "open question"),
  );

  if (!parts.length) return null;
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A compact shape summary, used when the final pass changes nothing. */
export function notesShape(result: IntelligenceResult): string {
  const parts = [
    result.keyPoints.length ? count(result.keyPoints.length, "key point") : "",
    result.decisions.length ? count(result.decisions.length, "decision") : "",
    result.actionItems.length
      ? count(result.actionItems.length, "action item")
      : "",
    result.questions.length
      ? count(result.questions.length, "open question")
      : "",
  ].filter(Boolean);
  return parts.length ? `unchanged · ${parts.join(", ")}` : "nothing to record";
}
