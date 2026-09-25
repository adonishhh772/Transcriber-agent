import type { MeetingAudioRecord, MeetingRecord } from "./db";
import { openBytes, openText, sealBytes, sealText } from "../intelligence/vault";

/** Envelope stored in IndexedDB. `id` and `updatedAt` stay outside so the library can sort without decrypting. */
export type SealedMeetingEnvelope = {
  id: string;
  updatedAt: number;
  v: 1;
  iv: string;
  data: string;
};

/** Audio envelope. The blob, mime type and duration are inside the ciphertext. */
export type SealedAudioEnvelope = {
  id: string;
  v: 1;
  iv: string;
  ciphertext: ArrayBuffer;
};

const AUDIO_HEADER_BYTES = 4;

export function isSealedMeeting(value: unknown): value is SealedMeetingEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as SealedMeetingEnvelope;
  return (
    record.v === 1 &&
    typeof record.id === "string" &&
    typeof record.iv === "string" &&
    typeof record.data === "string"
  );
}

export function isPlainMeeting(value: unknown): value is MeetingRecord {
  if (!value || typeof value !== "object" || isSealedMeeting(value)) return false;
  const record = value as MeetingRecord;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    Array.isArray(record.transcript)
  );
}

export function isSealedAudio(value: unknown): value is SealedAudioEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as SealedAudioEnvelope;
  return (
    record.v === 1 &&
    typeof record.id === "string" &&
    typeof record.iv === "string" &&
    record.ciphertext instanceof ArrayBuffer
  );
}

export function isPlainAudio(value: unknown): value is MeetingAudioRecord {
  if (!value || typeof value !== "object" || isSealedAudio(value)) return false;
  const record = value as MeetingAudioRecord;
  return typeof record.id === "string" && record.blob instanceof Blob;
}

export async function sealMeetingRecord(
  meeting: MeetingRecord,
): Promise<SealedMeetingEnvelope> {
  const sealed = await sealText(JSON.stringify(meeting));
  return {
    id: meeting.id,
    updatedAt: meeting.updatedAt,
    v: 1,
    iv: sealed.iv,
    data: sealed.data,
  };
}

export async function openSealedMeeting(
  envelope: SealedMeetingEnvelope,
): Promise<MeetingRecord> {
  const plaintext = await openText({ iv: envelope.iv, data: envelope.data });
  const parsed = JSON.parse(plaintext) as MeetingRecord;
  if (typeof parsed?.id !== "string" || !Array.isArray(parsed.transcript))
    throw new Error("The saved meeting could not be read.");
  return parsed;
}

export async function sealAudioRecord(
  record: MeetingAudioRecord,
): Promise<SealedAudioEnvelope> {
  const headerBytes = new TextEncoder().encode(
    JSON.stringify({
      mimeType: record.mimeType,
      bytes: record.bytes,
      durationMs: record.durationMs,
      savedAt: record.savedAt,
    }),
  );
  const audioBytes = new Uint8Array(await record.blob.arrayBuffer());
  const payload = new Uint8Array(
    AUDIO_HEADER_BYTES + headerBytes.byteLength + audioBytes.byteLength,
  );
  new DataView(payload.buffer).setUint32(0, headerBytes.byteLength, false);
  payload.set(headerBytes, AUDIO_HEADER_BYTES);
  payload.set(audioBytes, AUDIO_HEADER_BYTES + headerBytes.byteLength);
  const sealed = await sealBytes(payload.buffer);
  return {
    id: record.id,
    v: 1,
    iv: sealed.iv,
    ciphertext: sealed.ciphertext,
  };
}

export async function openSealedAudio(
  envelope: SealedAudioEnvelope,
): Promise<MeetingAudioRecord> {
  const plaintext = new Uint8Array(
    await openBytes(envelope.iv, envelope.ciphertext),
  );
  if (plaintext.byteLength < AUDIO_HEADER_BYTES)
    throw new Error("The saved meeting audio could not be read.");
  const headerLength = new DataView(
    plaintext.buffer,
    plaintext.byteOffset,
    plaintext.byteLength,
  ).getUint32(0, false);
  const headerStart = AUDIO_HEADER_BYTES;
  const headerEnd = headerStart + headerLength;
  if (headerEnd > plaintext.byteLength)
    throw new Error("The saved meeting audio could not be read.");
  const header = JSON.parse(
    new TextDecoder().decode(plaintext.subarray(headerStart, headerEnd)),
  ) as {
    mimeType?: unknown;
    bytes?: unknown;
    durationMs?: unknown;
    savedAt?: unknown;
  };
  if (typeof header.mimeType !== "string")
    throw new Error("The saved meeting audio could not be read.");
  const audioBytes = plaintext.subarray(headerEnd);
  const copy = new Uint8Array(audioBytes.byteLength);
  copy.set(audioBytes);
  return {
    id: envelope.id,
    blob: new Blob([copy], { type: header.mimeType }),
    mimeType: header.mimeType,
    bytes: typeof header.bytes === "number" ? header.bytes : copy.byteLength,
    durationMs: typeof header.durationMs === "number" ? header.durationMs : 0,
    savedAt: typeof header.savedAt === "number" ? header.savedAt : 0,
  };
}
