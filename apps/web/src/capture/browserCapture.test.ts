import { describe, expect, it } from "vitest";
import { NoSystemAudioError, getDisplaySurface } from "./browserCapture";

describe("browser capture helpers", () => {
  it("exposes the required no-system-audio message", () => {
    expect(new NoSystemAudioError().message).toBe(
      "No system audio was shared. Select Entire Screen and enable Share system audio.",
    );
  });

  it("reads the selected display surface from track settings", () => {
    const stream = {
      getVideoTracks: () => [
        { getSettings: () => ({ displaySurface: "monitor" }) },
      ],
    } as unknown as MediaStream;
    expect(getDisplaySurface(stream)).toBe("monitor");
  });
});
