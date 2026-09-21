/**
 * The note contract shared with the FastAPI service.
 *
 * `apps/api/transcript_protocol.py` answers with
 * `{title, executiveSummary, keyPoints, decisions, actionItems, questions}`,
 * and `services/llm/prompts.py` defines the analyst prompt. The direct-provider
 * path reuses both so the frontend produces the same notes with or without a
 * backend.
 */

export type ActionItem = {
  owner?: string;
  description: string;
  dueDate?: string;
};

export type IntelligenceResult = {
  title: string;
  executiveSummary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
  questions: string[];
};

export const EMPTY_RESULT: IntelligenceResult = {
  title: "",
  executiveSummary: "",
  keyPoints: [],
  decisions: [],
  actionItems: [],
  questions: [],
};

/** Mirrors the JSON schema the backend hands to the model. */
export const RESPONSE_SCHEMA = {
  type: "object",
  required: ["title", "executiveSummary", "keyPoints", "actionItems"],
  properties: {
    title: { type: "string", maxLength: 200 },
    executiveSummary: { type: "string" },
    keyPoints: { type: "array", items: { type: "string" }, maxItems: 20 },
    decisions: { type: "array", items: { type: "string" }, maxItems: 12 },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        required: ["description"],
        properties: {
          owner: { type: "string" },
          description: { type: "string" },
          dueDate: { type: "string" },
        },
      },
    },
    questions: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
} as const;

export const SYSTEM_PROMPT =
  "You are an expert meeting analyst. " +
  "Write concise, actionable meeting notes. " +
  "Always return ONLY a single JSON object that matches the provided schema. " +
  "Prefer bullet/point-form phrasing, avoid repetition, and extract concrete actions.";

/* ---------------------------------------------------------------------------
   Where a note came from
   ------------------------------------------------------------------------ */

/** The editable note sections, in the order the document shows them. */
export const NOTE_SECTION_KEYS = [
  "summary",
  "keyPoints",
  "decisions",
  "actionItems",
  "questions",
] as const;

export type NoteSectionKey = (typeof NOTE_SECTION_KEYS)[number];

/** One transcript line, as it was handed to the model. */
export type SourceLine = { atMs: number; text: string };

/**
 * Exactly what one notes request was given.
 *
 * A summary is only as good as the material behind it, and "where did that come
 * from?" is the first question anybody asks of an AI-written line. Every pass
 * therefore records its own inputs — which transcript lines and which screen
 * captures it read — so each section, and every row of the AI activity log, can
 * show the content it was written from rather than asking the reader to trust
 * it.
 *
 * The lines are held as a range into the meeting's own transcript, which is
 * append-only, rather than as a copy: a pass costs two numbers, so every pass of
 * a long meeting can be kept instead of a trimmed recent few.
 */
export type NotesSource = {
  /** Milliseconds into the meeting when the pass ran. */
  atMs: number;
  /** The end-of-meeting pass rather than a rolling one. */
  final: boolean;
  /** Provider · model that answered, for the record. */
  model: string;
  /** Which speech engine produced the lines ("Deepgram", "Local Whisper"…). */
  engine: string;
  /** First transcript line the pass was given. */
  from: number;
  /** One past the last transcript line the pass was given. */
  to: number;
  /** What the shared screen showed during that pass, in order. */
  screenNotes: SourceLine[];
};

/** How many transcript lines a rolling pass reads (the prompt's own window). */
export const ROLLING_TRANSCRIPT_LINES = 100;

/** The lines a pass read, following its range into `transcript`. */
export function sourceLines(
  source: NotesSource,
  transcript: SourceLine[],
): SourceLine[] {
  return transcript.slice(source.from, source.to);
}

/** One-line description of a pass, shown above the content it read. */
export function describeNotesSource(source: NotesSource): string {
  const parts = [source.final ? "End-of-meeting pass" : "Rolling pass"];
  parts.push(`at ${formatClock(source.atMs)}`);
  const lines = source.to - source.from;
  parts.push(
    source.from === 0
      ? "the whole transcript"
      : `${lines} transcript line${lines === 1 ? "" : "s"}`,
  );
  if (source.screenNotes.length)
    parts.push(
      `${source.screenNotes.length} screen capture${source.screenNotes.length === 1 ? "" : "s"}`,
    );
  if (source.model) parts.push(source.model);
  if (source.engine) parts.push(`lines from ${source.engine}`);
  return parts.join(" · ");
}

/**
 * The content of a pass, as plain text.
 *
 * Used by the copy action and by the tests: what was summarised is a fact worth
 * being able to take away, not just look at. `transcript` is the meeting's own
 * lines, which the pass's range points into.
 */
export function notesSourceText(
  source: NotesSource,
  transcript: SourceLine[] = [],
): string {
  const heading = describeNotesSource(source);
  const body = sourceLines(source, transcript).map(
    (line) => `[${formatClock(line.atMs)}] ${line.text}`,
  );
  const screen = source.screenNotes.map(
    (note) => `[${formatClock(note.atMs)}] ${note.text}`,
  );
  return [
    heading,
    "",
    "Transcript:",
    ...(body.length ? body : ["Nothing had been transcribed yet."]),
    ...(screen.length ? ["", "Shared screen:", ...screen] : []),
  ].join("\n");
}

export function buildPrompt(
  transcript: string,
  final: boolean,
  screenNotes: Array<{ atMs: number; text: string }> = [],
): string {
  const guidelines = final
    ? [
        "- Title: at most 200 characters, plain text.",
        "- Executive summary: 4–8 sentences, no filler.",
        "- 8–15 key points maximum, no duplicates, chronological when possible.",
        "- Decisions: only what the room actually agreed to.",
        "- Action items: include every concrete commitment, with owner and dueDate when stated.",
        "- Questions: what was left unresolved.",
      ]
    : [
        "- 4–8 key points maximum.",
        "- Executive summary: 2–4 coherent sentences.",
        "- Decisions and action items only when stated or clearly implied.",
        "- Questions: what was left unresolved.",
      ];
  const screenSection = screenNotes.length
    ? [
        "",
        "What was on the shared screen, in order (describe these as part of the meeting; do not invent anything beyond them):",
        ...screenNotes.map(
          (note) => `- ${formatClock(note.atMs)}: ${note.text}`,
        ),
      ]
    : [];
  return [
    `${final ? "Full" : "Recent"} transcript (ordered, lightly cleaned):`,
    transcript,
    ...screenSection,
    "",
    "Schema (respond with JSON matching this):",
    JSON.stringify(RESPONSE_SCHEMA),
    "",
    "Guidelines:",
    ...guidelines,
  ].join("\n");
}

/** mm:ss for prompt-side and exported timestamps. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/* ---------------------------------------------------------------------------
   Response handling
   ------------------------------------------------------------------------ */

/** Models often wrap JSON in prose or code fences; recover the object. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const start = trimmed.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(trimmed.slice(start, index + 1));
          break;
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object") return value;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    "The model did not return valid JSON. Try again or switch model.",
  );
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(toStringValue).filter((item) => item.length > 0);
}

function toActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return [];
  const items: ActionItem[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const description = entry.trim();
      if (description) items.push({ description });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const description = toStringValue(
      record.description ?? record.task ?? record.text ?? record.item,
    );
    if (!description) continue;
    const item: ActionItem = { description };
    const owner = toStringValue(record.owner ?? record.assignee ?? record.who);
    const dueDate = toStringValue(record.dueDate ?? record.due ?? record.when);
    if (owner) item.owner = owner;
    if (dueDate) item.dueDate = dueDate;
    items.push(item);
  }
  return items;
}

/** Coerce any provider response into the shape the UI renders. */
export function normalizeResult(raw: unknown): IntelligenceResult {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    title: toStringValue(record.title),
    executiveSummary: toStringValue(
      record.executiveSummary ?? record.summary ?? record.notes,
    ),
    keyPoints: toStringList(record.keyPoints ?? record.key_points),
    decisions: toStringList(record.decisions),
    actionItems: toActionItems(
      record.actionItems ?? record.actions ?? record.action_items,
    ),
    questions: toStringList(record.questions ?? record.openQuestions),
  };
}

/** Single-line rendering used by the editable Action items field. */
export function formatActionItem(item: ActionItem): string {
  const parts: string[] = [];
  if (item.owner) parts.push(item.owner);
  if (item.dueDate) parts.push(`by ${item.dueDate}`);
  return parts.length
    ? `${parts.join(" ")} — ${item.description}`
    : item.description;
}

export function hasNotes(result: IntelligenceResult): boolean {
  return Boolean(
    result.executiveSummary ||
    result.keyPoints.length ||
    result.decisions.length ||
    result.actionItems.length ||
    result.questions.length,
  );
}
