import type { TranscriptSegment } from "../transcript/dedup";
import type { AiActivityEntry } from "../intelligence/activity";
import { ACTIVITY_LABELS } from "../intelligence/activity";
import { formatClock, type IntelligenceResult } from "../intelligence/notes";

/**
 * Markdown export. Kept dependency-free so it works with notes produced by
 * either the local FastAPI service or a direct provider call.
 */

type ExportableMeeting = {
  title: string;
  transcript: TranscriptSegment[];
  manualNotes: string;
  generatedNotes: Record<string, unknown>;
  summary: Record<string, unknown> | null;
  /** What the shared screen showed, in order. */
  screenNotes?: Array<{ atMs: number; text: string }>;
  /** Questions asked about this meeting, in order. */
  qa?: Array<{ atMs: number; question: string; answer: string }>;
  /** Changelog of what the AI suggested and when it changed. */
  aiActivity?: AiActivityEntry[];
};

export function exportMarkdown(meeting: ExportableMeeting): string {
  const summary = meeting.summary ?? meeting.generatedNotes ?? {};
  const notes = summary as Partial<IntelligenceResult>;
  const actions = Array.isArray(notes.actionItems) ? notes.actionItems : [];
  const screenNotes = meeting.screenNotes ?? [];
  const qa = meeting.qa ?? [];
  const activity = meeting.aiActivity ?? [];
  return [
    `# ${meeting.title}`,
    "",
    "## Summary",
    String(notes.executiveSummary ?? ""),
    "",
    "## Key points",
    ...(Array.isArray(notes.keyPoints)
      ? notes.keyPoints.map((item) => `- ${item}`)
      : []),
    "",
    "## Decisions",
    ...(Array.isArray(notes.decisions)
      ? notes.decisions.map((item) => `- ${item}`)
      : []),
    "",
    "## Action items",
    ...actions.map((item) => `- ${formatAction(item)}`),
    "",
    "## Open questions",
    ...(Array.isArray(notes.questions)
      ? notes.questions.map((item) => `- ${item}`)
      : []),
    "",
    "## Shared screen",
    ...(screenNotes.length
      ? screenNotes.map((note) => `- [${formatClock(note.atMs)}] ${note.text}`)
      : ["Nothing was read from a shared screen."]),
    "",
    "## Personal notes",
    meeting.manualNotes,
    "",
    "## Questions asked",
    ...(qa.length
      ? qa.flatMap((turn) => [
          `**${turn.question}**`,
          "",
          turn.answer,
          "",
        ])
      : ["None."]),
    "",
    "## What the AI changed",
    ...(activity.length
      ? activity.map(
          (entry) =>
            `- [${formatClock(entry.atMs)}] ${ACTIVITY_LABELS[entry.kind]}: ${entry.text}`,
        )
      : ["The AI did not run during this meeting."]),
    "",
    "## Transcript",
    ...meeting.transcript.map(
      (item) => `- [${Math.round(item.startMs / 1000)}s] ${item.text}`,
    ),
  ].join("\n");
}

function formatAction(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const description = record.description ?? record.task ?? record.text;
    if (typeof description === "string") {
      const owner = record.owner ?? record.assignee;
      const due = record.dueDate ?? record.due;
      const prefix = [
        typeof owner === "string" ? owner : "",
        typeof due === "string" ? `by ${due}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return prefix ? `${prefix} — ${description}` : description;
    }
  }
  return JSON.stringify(item);
}
