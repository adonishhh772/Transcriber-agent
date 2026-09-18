import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MeetingRecorder,
  formatBytes,
  pickRecordingMimeType,
  recordingSupported,
} from "./recorder";

type Chunk = { data: Blob };

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supported = ["audio/webm;codecs=opus", "audio/webm"];
  static isTypeSupported = (type: string) =>
    FakeMediaRecorder.supported.includes(type);

  state = "inactive";
  mimeType: string;
  ondataavailable: ((event: Chunk) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    readonly stream: unknown,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.onstop?.();
  }

  emit(bytes: number): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

const stream = { id: "mixed" } as unknown as MediaStream;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  /* Node has no MediaStream; the recorder only needs it to exist. */
  vi.stubGlobal("MediaStream", class {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickRecordingMimeType", () => {
  it("uses the first supported container", () => {
    expect(pickRecordingMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(
      pickRecordingMimeType((type) => type === "audio/ogg;codecs=opus"),
    ).toBe("audio/ogg;codecs=opus");
  });

  it("lets the browser decide when nothing is advertised", () => {
    expect(pickRecordingMimeType(() => false)).toBe("");
  });
});

describe("formatBytes", () => {
  it("reads in KB and MB", () => {
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("MeetingRecorder", () => {
  it("reports when recording is unsupported", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(recordingSupported()).toBe(false);
    expect(new MeetingRecorder().start(stream)).toBe(false);
  });

  it("collects chunks and returns them on stop", async () => {
    const recorder = new MeetingRecorder();
    expect(recorder.start(stream)).toBe(true);
    expect(recorder.isRecording).toBe(true);

    const active = FakeMediaRecorder.instances[0];
    active.emit(1024);
    active.emit(2048);
    expect(recorder.recordedBytes).toBe(3072);

    const result = await recorder.stop();
    expect(result).not.toBeNull();
    expect(result?.bytes).toBe(3072);
    expect(result?.blob.size).toBe(3072);
    expect(result?.mimeType).toBe("audio/webm;codecs=opus");
    expect(result?.durationMs).toBeGreaterThanOrEqual(0);
    expect(recorder.isRecording).toBe(false);
  });

  it("returns null when nothing was captured", async () => {
    const recorder = new MeetingRecorder();
    recorder.start(stream);
    await expect(recorder.stop()).resolves.toBeNull();
  });

  it("stops a previous recording when started again", async () => {
    const recorder = new MeetingRecorder();
    recorder.start(stream);
    FakeMediaRecorder.instances[0].emit(512);
    recorder.start(stream);
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(recorder.recordedBytes).toBe(0);
    const result = await recorder.stop();
    expect(result).toBeNull();
  });
});
