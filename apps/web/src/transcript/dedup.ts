export type TranscriptSegment = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
};

export function normalizeTranscriptText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function mergeOverlappingTranscript(
  previous: TranscriptSegment[],
  incoming: TranscriptSegment,
): TranscriptSegment[] {
  const cleanText = incoming.text.trim();
  if (!cleanText) return previous;
  const normalizedIncoming = normalizeTranscriptText(cleanText);
  if (!normalizedIncoming) return previous;

  const last = previous[previous.length - 1];
  if (!last) return [...previous, { ...incoming, text: cleanText }];
  const normalizedLast = normalizeTranscriptText(last.text);
  if (
    normalizedIncoming === normalizedLast &&
    incoming.startMs <= last.endMs + 1500
  )
    return previous;
  if (
    incoming.startMs >= last.endMs - 250 &&
    normalizedIncoming.includes(normalizedLast)
  )
    return previous;

  const lastWords = normalizedLast.split(" ");
  const incomingWords = normalizedIncoming.split(" ");
  let overlap = 0;
  const maxOverlap = Math.min(lastWords.length, incomingWords.length, 12);
  for (let size = maxOverlap; size >= 1; size -= 1) {
    if (
      lastWords.slice(-size).join(" ") ===
      incomingWords.slice(0, size).join(" ")
    ) {
      overlap = size;
      break;
    }
  }

  if (overlap > 0) {
    const suffix = incomingWords.slice(overlap).join(" ");
    if (!suffix) return previous;
    return [...previous, { ...incoming, text: suffix }];
  }
  return [...previous, { ...incoming, text: cleanText }];
}
