/**
 * Reads the shared screen during a meeting.
 *
 * The display stream is already open for system audio, so its video track is
 * grabbed periodically, downscaled and sent to a vision model. The model
 * decides whether anything worth keeping is on screen — a shared deck, a
 * document, a chart — and answers `NO_CONTENT` for a video-call grid, a desktop
 * or anything illegible. Unchanged frames are never sent at all.
 *
 * Only the model's text is kept; the frames themselves are discarded.
 */

export const NO_CONTENT = "NO_CONTENT";

export type ScreenSummary = {
  atMs: number;
  text: string;
};

export type ScreenReaderOptions = {
  /** How often to look, in milliseconds. */
  intervalMs?: number;
  /** Sends one frame and resolves with the model's answer. */
  describe: (dataUrl: string) => Promise<string>;
  onSummary: (summary: ScreenSummary) => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
  /** Width the frame is scaled to before it is sent. */
  targetWidth?: number;
  now?: () => number;
};

export const DEFAULT_SCREEN_INTERVAL_MS = 25_000;
const TARGET_WIDTH = 640;
const SIGNATURE_WIDTH = 32;
const SIGNATURE_HEIGHT = 18;
/** Mean per-pixel difference (0-255) below which two frames count as equal. */
export const FRAME_CHANGE_THRESHOLD = 6;
/** Re-read a frozen screen at least this often, in case of a slow change. */
const FORCE_REFRESH_TICKS = 8;

/** Mean absolute difference between two luminance samples. */
export function frameDifference(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < a.length; index += 1)
    total += Math.abs(a[index] - b[index]);
  return total / a.length;
}

export function framesDiffer(
  previous: number[] | null,
  next: number[],
  threshold = FRAME_CHANGE_THRESHOLD,
): boolean {
  if (!previous) return true;
  return frameDifference(previous, next) >= threshold;
}

/** True when the model says there is nothing worth recording on screen. */
export function isNoContent(reply: string): boolean {
  const text = reply.trim();
  if (!text) return true;
  return text.toUpperCase().includes(NO_CONTENT);
}

/** Comparison key for de-duplicating repeated descriptions of one slide. */
export function summaryKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether a new description adds anything over the previous one. */
export function isNewSummary(previous: string, next: string): boolean {
  const before = summaryKey(previous);
  const after = summaryKey(next);
  if (!after) return false;
  if (!before) return true;
  if (before === after) return false;
  return !(after.includes(before) || before.includes(after));
}

export class ScreenReader {
  private readonly options: ScreenReaderOptions & { intervalMs: number };
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private signature: number[] | null = null;
  private unchangedTicks = 0;
  private lastSummary = "";
  /** The frame the summary on screen came from. Memory only, never stored. */
  private frame: string | null = null;
  private busy = false;
  private running = false;
  private startedAt = 0;

  constructor(options: ScreenReaderOptions) {
    this.options = {
      intervalMs: DEFAULT_SCREEN_INTERVAL_MS,
      targetWidth: TARGET_WIDTH,
      ...options,
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * The downscaled frame the model read for the newest summary, so the user can
   * check what was actually sent. It is deliberately not persisted anywhere and
   * is dropped as soon as the reader stops.
   */
  get lastFrame(): string | null {
    return this.frame;
  }

  start(stream: MediaStream): boolean {
    const [track] = stream.getVideoTracks();
    if (!track) return false;
    this.stop();
    const video = document.createElement("video");
    video.srcObject = new MediaStream([track]);
    video.muted = true;
    video.playsInline = true;
    this.video = video;
    /* Without this the element can sit on its first frame forever, and every
       later read would describe a screen from minutes ago. */
    void video.play?.().catch(() => undefined);
    this.canvas = document.createElement("canvas");
    this.signature = null;
    this.unchangedTicks = 0;
    this.lastSummary = "";
    this.frame = null;
    this.running = true;
    this.startedAt = this.now();
    this.options.onStatus?.("Watching the shared screen");
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    return true;
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    const video = this.video;
    this.video = null;
    this.canvas = null;
    this.signature = null;
    this.frame = null;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }

  /** Stops looking while a meeting is paused, keeping the stream attached. */
  pause(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  resume(): void {
    if (!this.video || this.timer !== null) return;
    this.running = true;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
  }

  /** One look at the screen: cheap change check first, then the model. */
  async tick(): Promise<void> {
    if (!this.running || this.busy || !this.video || !this.canvas) return;
    const sample = this.sampleFrame();
    if (!sample) return;
    const changed = framesDiffer(this.signature, sample.signature);
    this.signature = sample.signature;
    if (!changed) {
      this.unchangedTicks += 1;
      if (this.unchangedTicks < FORCE_REFRESH_TICKS) return;
    }
    this.unchangedTicks = 0;
    this.busy = true;
    try {
      const reply = await this.options.describe(sample.dataUrl);
      if (!this.running) return;
      if (isNoContent(reply)) {
        this.options.onStatus?.("Nothing readable on screen");
        return;
      }
      const text = reply.trim();
      if (!isNewSummary(this.lastSummary, text)) return;
      this.lastSummary = text;
      /* Kept with the summary it belongs to, so the preview can never show a
         frame that produced a different description. */
      this.frame = sample.dataUrl;
      this.options.onSummary({ atMs: this.now() - this.startedAt, text });
      this.options.onStatus?.("Screen captured");
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error.message : "Screen reading failed.",
      );
    } finally {
      this.busy = false;
    }
  }

  /** Draws the current frame twice: a JPEG to send and a tiny signature. */
  private sampleFrame(): { dataUrl: string; signature: number[] } | null {
    const video = this.video;
    const canvas = this.canvas;
    if (!video || !canvas || video.videoWidth === 0) return null;
    const scale = Math.min(
      1,
      (this.options.targetWidth ?? TARGET_WIDTH) / video.videoWidth,
    );
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    try {
      context.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      const small = document.createElement("canvas");
      small.width = SIGNATURE_WIDTH;
      small.height = SIGNATURE_HEIGHT;
      const smallContext = small.getContext("2d");
      if (!smallContext) return { dataUrl, signature: [] };
      smallContext.drawImage(video, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
      const pixels = smallContext.getImageData(
        0,
        0,
        SIGNATURE_WIDTH,
        SIGNATURE_HEIGHT,
      ).data;
      const signature: number[] = [];
      for (let index = 0; index < pixels.length; index += 4) {
        signature.push(
          (pixels[index] * 299 +
            pixels[index + 1] * 587 +
            pixels[index + 2] * 114) /
            1000,
        );
      }
      return { dataUrl, signature };
    } catch {
      /* A frame can fail while the share is being set up. */
      return null;
    }
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }
}

export const SCREEN_PROMPT =
  "This image is the shared screen during a meeting. In at most two sentences, " +
  "say what it shows: the title, the key points, numbers or names, and what kind " +
  "of content it is (slide, document, chart, table, code, whiteboard). " +
  "If it shows only people on a video call, a desktop, chat, or nothing legible, " +
  `reply exactly ${NO_CONTENT} and nothing else.`;
