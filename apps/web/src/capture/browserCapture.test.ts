import { describe, expect, it } from "vitest";
import {
  NoSystemAudioError,
  describeDisplaySurface,
  getDisplayMediaConstraints,
  getDisplaySurface,
  isWholeScreen,
} from "./browserCapture";

describe("browser capture helpers", () => {
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
