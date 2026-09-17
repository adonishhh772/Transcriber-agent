import type { TranscriptSegment } from "../transcript/dedup";
import type { IntelligenceResult } from "../intelligence/notes";

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
};

export function exportMarkdown(meeting: ExportableMeeting): string {
  const summary = meeting.summary ?? meeting.generatedNotes ?? {};
  const notes = summary as Partial<IntelligenceResult>;
  const actions = Array.isArray(notes.actionItems) ? notes.actionItems : [];
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
    "## Personal notes",
    meeting.manualNotes,
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
