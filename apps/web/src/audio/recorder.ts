/**
 * Records the mixed meeting audio (microphone + system audio) for the duration
 * of a meeting, so a transcript can be replayed against its audio.
 *
 * The result stays in the browser: it is handed back as a Blob and stored with
 * the meeting, never uploaded.
 */

export type RecordingResult = {
  blob: Blob;
  mimeType: string;
  bytes: number;
  durationMs: number;
};

/** Preference order: Opus in WebM is what Chromium and Firefox support best. */
const CANDIDATE_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function pickRecordingMimeType(
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported(type),
): string {
  for (const type of CANDIDATE_TYPES) if (isSupported(type)) return type;
  return "";
}

export function recordingSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaStream !== "undefined"
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb.toFixed(1)} MB`;
}

export class MeetingRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private stoppedAt = 0;
  private bytes = 0;
  private mimeType = "";
  private active = false;

  /** Starts recording; returns false when the browser cannot record. */
  start(stream: MediaStream): boolean {
    if (!recordingSupported()) return false;
    this.stopTracksIfRunning();
    this.chunks = [];
    this.bytes = 0;
    this.mimeType = pickRecordingMimeType();
    try {
      this.recorder = this.mimeType
        ? new MediaRecorder(stream, { mimeType: this.mimeType })
        : new MediaRecorder(stream);
    } catch {
      this.recorder = null;
      return false;
    }
    this.mimeType = this.recorder.mimeType || this.mimeType;
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
        this.bytes += event.data.size;
      }
    };
    this.startedAt = Date.now();
    this.stoppedAt = 0;
    this.active = true;
    /* A timeslice keeps memory chunky instead of one huge buffer at the end. */
    try {
      this.recorder.start(5_000);
    } catch {
      this.active = false;
      this.recorder = null;
      return false;
    }
    return true;
  }

  get isRecording(): boolean {
    return this.active;
  }

  get recordedBytes(): number {
    return this.bytes;
  }

  get elapsedMs(): number {
    if (!this.startedAt) return 0;
    return (this.stoppedAt || Date.now()) - this.startedAt;
  }

  /** Stops and returns everything recorded, or null when nothing was captured. */
  async stop(): Promise<RecordingResult | null> {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder) {
      this.active = false;
      return null;
    }
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      recorder.onstop = finish;
      recorder.onerror = finish;
      try {
        if (recorder.state !== "inactive") recorder.stop();
        else finish();
      } catch {
        finish();
      }
    });
    this.active = false;
    this.stoppedAt = Date.now();
    if (this.chunks.length === 0) return null;
    const blob = new Blob(this.chunks, {
      type: this.mimeType || this.chunks[0]?.type || "audio/webm",
    });
    const result: RecordingResult = {
      blob,
      mimeType: blob.type,
      bytes: blob.size,
      durationMs: this.elapsedMs,
    };
    this.chunks = [];
    return result;
  }

  private stopTracksIfRunning(): void {
    if (!this.recorder) return;
    try {
      if (this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      /* already gone */
    }
    this.recorder = null;
    this.active = false;
  }
}
