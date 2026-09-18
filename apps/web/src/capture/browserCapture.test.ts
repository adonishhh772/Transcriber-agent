import { describe, expect, it, vi } from "vitest";
import {
  NoSystemAudioError,
  captureSupport,
  describeDisplaySurface,
  getDisplayMediaConstraints,
  getDisplaySurface,
  isMobileBrowser,
  isWholeScreen,
} from "./browserCapture";

describe("browser capture helpers", () => {
  it("recognises a phone, including an iPad pretending to be a Mac", () => {
    const withAgent = (agent: string, touchPoints = 0) => {
      vi.stubGlobal("navigator", {
        userAgent: agent,
        maxTouchPoints: touchPoints,
      });
      return isMobileBrowser();
    };
    expect(withAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile")).toBe(true);
    expect(
      withAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
      ),
    ).toBe(true);
    expect(withAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(
      true,
    );
    expect(
      withAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0"),
    ).toBe(false);
    vi.unstubAllGlobals();
  });

  it("tells a phone user why capture is impossible instead of being vague", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("location", { hostname: "adonishhh772.github.io" });
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile",
      maxTouchPoints: 5,
      mediaDevices: { getUserMedia: () => {} },
    });
    const support = captureSupport();
    expect(support.supported).toBe(false);
    expect(support.reason).toMatch(/phones and tablets/);
    expect(support.reason).toMatch(/Chrome or Edge on a computer/);
    vi.unstubAllGlobals();
  });

  it("asks for one fixed surface, with audio, at the top level of the options", () => {
    const options = getDisplayMediaConstraints();
    /* These live at the top level: nested inside `audio` the browser drops them,
       which is how a shared surface used to be swappable mid-meeting. */
    expect(options.selfBrowserSurface).toBe("exclude");
    expect(options.surfaceSwitching).toBe("exclude");
    expect(options.systemAudio).toBe("include");
    expect((options.video as MediaTrackConstraints).displaySurface).toBe("window");
  });

  it("tells the user how to get meeting audio", () => {
    expect(new NoSystemAudioError().message).toContain("Share system audio");
    expect(new NoSystemAudioError().message).toContain("meeting window");
  });

  it("reads the selected display surface from track settings", () => {
    const stream = {
      getVideoTracks: () => [
        { getSettings: () => ({ displaySurface: "monitor" }) },
      ],
    } as unknown as MediaStream;
    expect(getDisplaySurface(stream)).toBe("monitor");
  });

  it("knows when the whole screen was shared, and says which surface it is", () => {
    expect(isWholeScreen("monitor")).toBe(true);
    expect(isWholeScreen("window")).toBe(false);
    expect(isWholeScreen(null)).toBe(false);
    expect(describeDisplaySurface("monitor")).toBe("your whole screen");
    expect(describeDisplaySurface("window")).toBe("the shared window");
    expect(describeDisplaySurface("browser")).toBe("the shared tab");
    expect(describeDisplaySurface(null)).toBe("the surface you shared");
  });
});
