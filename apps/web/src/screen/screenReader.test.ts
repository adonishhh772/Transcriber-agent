import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_CONTENT,
  ScreenReader,
  frameDifference,
  framesDiffer,
  isNewSummary,
  isNoContent,
  summaryKey,
} from "./screenReader";

describe("frame comparison", () => {
  it("measures the mean difference between samples", () => {
    expect(frameDifference([10, 20], [10, 20])).toBe(0);
    expect(frameDifference([0, 0], [10, 20])).toBe(15);
    expect(frameDifference([1], [])).toBe(Number.POSITIVE_INFINITY);
  });

  it("treats a first frame as changed and a near-identical one as not", () => {
    expect(framesDiffer(null, [1, 2, 3])).toBe(true);
    expect(framesDiffer([100, 100], [102, 101])).toBe(false);
    expect(framesDiffer([100, 100], [140, 100])).toBe(true);
  });
});

describe("model answers", () => {
  it("recognises a screen with nothing worth keeping", () => {
    expect(isNoContent("")).toBe(true);
    expect(isNoContent(NO_CONTENT)).toBe(true);
    expect(isNoContent("no_content")).toBe(true);
    expect(isNoContent("NO_CONTENT — only faces visible")).toBe(true);
    expect(isNoContent("A slide titled Roadmap, three quarters.")).toBe(false);
  });

  it("de-duplicates repeated descriptions of one screen", () => {
    expect(summaryKey("Revenue: Q3 up 12%!")).toBe("revenue q3 up 12");
    expect(isNewSummary("", "A slide")).toBe(true);
    expect(isNewSummary("A slide", "a slide")).toBe(false);
    expect(isNewSummary("Roadmap slide", "Roadmap slide, three quarters")).toBe(
      false,
    );
    expect(isNewSummary("Roadmap slide", "Budget table with 12 rows")).toBe(true);
    expect(isNewSummary("Something", "   ")).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
   The reader itself, against a fake video/canvas pair.
   ------------------------------------------------------------------------ */

type FakeContext = {
  drawImage: () => void;
  getImageData: () => { data: Uint8ClampedArray };
};

function installDom(initialLuma: number) {
  let luma = initialLuma;
  const contexts: FakeContext[] = [];
  const makeCanvas = () => ({
    width: 0,
    height: 0,
    getContext: () => {
      const context: FakeContext = {
        drawImage: () => {},
        getImageData: () => {
          const data = new Uint8ClampedArray(32 * 18 * 4);
          for (let index = 0; index < data.length; index += 4) {
            data[index] = luma;
            data[index + 1] = luma;
            data[index + 2] = luma;
            data[index + 3] = 255;
          }
          return { data };
        },
      };
      contexts.push(context);
      return context;
    },
    toDataURL: () => `data:image/jpeg;base64,frame-${luma}`,
  });
  const video = {
    videoWidth: 1280,
    videoHeight: 720,
    srcObject: null as unknown,
    muted: false,
    playsInline: false,
    pause: () => {},
  };
  vi.stubGlobal("document", {
    createElement: (tag: string) => (tag === "video" ? video : makeCanvas()),
  });
  /* Node has no MediaStream; the reader only wraps the track in one. */
  vi.stubGlobal("MediaStream", class {
    constructor(readonly tracks: unknown[]) {}
  });
  return { video, setLuma: (next: number) => (luma = next) };
}

const stream = {
  getVideoTracks: () => [{ id: "screen" }],
} as unknown as MediaStream;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ScreenReader", () => {
  it("sends the first frame and stores what the model describes", async () => {
    installDom(30);
    const summaries: Array<{ atMs: number; text: string }> = [];
    const describe = vi.fn(async (_dataUrl: string) => "A slide titled Roadmap.");
    const reader = new ScreenReader({
      describe,
      onSummary: (summary) => summaries.push(summary),
      intervalMs: 1000,
      now: () => 5_000,
    });
    expect(reader.start(stream)).toBe(true);

    await reader.tick();
    expect(describe).toHaveBeenCalledTimes(1);
    expect(String(describe.mock.calls[0][0])).toContain("data:image/jpeg;base64");
    expect(summaries).toEqual([{ atMs: 0, text: "A slide titled Roadmap." }]);
    reader.stop();
  });

  it("skips a screen that has not changed", async () => {
    installDom(30);
    const describe = vi.fn(async () => "A slide.");
    const reader = new ScreenReader({ describe, onSummary: () => {}, intervalMs: 1000 });
    reader.start(stream);
    await reader.tick();
    await reader.tick();
    await reader.tick();
    expect(describe).toHaveBeenCalledTimes(1);
    reader.stop();
  });

  it("drops frames the model calls empty and does not repeat itself", async () => {
    const dom = installDom(30);
    const summaries: string[] = [];
    const replies = [NO_CONTENT, "Budget table.", "Budget table, slightly wider."];
    const describe = vi.fn(async () => replies.shift() ?? "Budget table.");
    const reader = new ScreenReader({
      describe,
      onSummary: (summary) => summaries.push(summary.text),
      intervalMs: 1000,
    });
    reader.start(stream);

    await reader.tick();
    expect(summaries).toEqual([]);

    dom.setLuma(120);
    await reader.tick();
    expect(summaries).toEqual(["Budget table."]);

    /* Same slide, slightly different pixels, near-identical description. */
    dom.setLuma(200);
    await reader.tick();
    expect(summaries).toEqual(["Budget table."]);

    dom.setLuma(20);
    replies.push("Next slide: hiring plan.");
    await reader.tick();
    expect(summaries).toEqual(["Budget table.", "Next slide: hiring plan."]);
    reader.stop();
  });

  it("keeps the frame behind the summary, and drops it when it stops", async () => {
    const dom = installDom(30);
    const replies = ["Budget table.", NO_CONTENT];
    const describe = vi.fn(async () => replies.shift() ?? NO_CONTENT);
    const reader = new ScreenReader({
      describe,
      onSummary: () => {},
      intervalMs: 1000,
    });
    reader.start(stream);
    expect(reader.lastFrame).toBeNull();

    await reader.tick();
    expect(reader.lastFrame).toBe("data:image/jpeg;base64,frame-30");

    /* A frame the model called empty must not replace the one being shown. */
    dom.setLuma(120);
    await reader.tick();
    expect(reader.lastFrame).toBe("data:image/jpeg;base64,frame-30");

    reader.stop();
    expect(reader.lastFrame).toBeNull();
  });

  it("stops asking when the provider fails, reporting once", async () => {
    installDom(30);
    const errors: string[] = [];
    const describe = vi.fn(async () => {
      throw new Error("DeepSeek rejected the API key.");
    });
    const reader = new ScreenReader({
      describe,
      onSummary: () => {},
      onError: (message) => errors.push(message),
      intervalMs: 1000,
    });
    reader.start(stream);
    await reader.tick();
    expect(errors).toEqual(["DeepSeek rejected the API key."]);
    reader.stop();
  });
});
