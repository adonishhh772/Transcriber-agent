import { describe, expect, it, vi } from "vitest";
import {
  NoSystemAudioError,
  captureSupport,
  describeDisplaySurface,
  getDisplayMediaConstraints,
  getDisplaySurface,
  isMobileBrowser,
  isWholeScreen,
  reacquireDisplay,
  type CaptureStreams,
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

/* ---- Re-sharing a surface without losing the meeting -------------------- */

type FakeTrack = {
  kind: "audio" | "video";
  readyState: string;
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => { displaySurface?: string };
};

function fakeTrack(kind: "audio" | "video", surface?: string): FakeTrack {
  return {
    kind,
    readyState: "live",
    stop: vi.fn(function (this: FakeTrack) {
      this.readyState = "ended";
    }),
    getSettings: () => (surface ? { displaySurface: surface } : {}),
  };
}

function fakeStream(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
  } as unknown as MediaStream;
}

/**
 * `reacquireDisplay` builds a stream out of the new audio tracks, and Node has
 * no MediaStream: the stub is the browser's constructor, no more.
 */
class FakeMediaStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}

/** The smallest capture graph `reacquireDisplay` can be handed. */
function fakeCapture(): {
  streams: CaptureStreams;
  nodes: {
    oldDisplaySource: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
    displayAnalyser: { connect: ReturnType<typeof vi.fn> };
    mixer: { connect: ReturnType<typeof vi.fn> };
  };
  created: Array<{ stream: MediaStream; connect: ReturnType<typeof vi.fn> }>;
  oldDisplayTracks: FakeTrack[];
} {
  const created: Array<{
    stream: MediaStream;
    connect: ReturnType<typeof vi.fn>;
  }> = [];
  const oldDisplayTracks = [fakeTrack("video", "window"), fakeTrack("audio")];
  const oldDisplay = fakeStream(oldDisplayTracks);
  const oldDisplaySource = { connect: vi.fn(), disconnect: vi.fn() };
  const displayAnalyser = { connect: vi.fn() };
  const mixer = { connect: vi.fn() };
  const streams = {
    display: oldDisplay,
    microphone: fakeStream([fakeTrack("audio")]),
    mixed: fakeStream([fakeTrack("audio")]),
    audioContext: {
      createMediaStreamSource: (stream: MediaStream) => {
        const node = { connect: vi.fn(), disconnect: vi.fn() };
        created.push({ stream, connect: node.connect });
        return node;
      },
    },
    displaySource: oldDisplaySource,
    microphoneSource: { connect: vi.fn(), disconnect: vi.fn() },
    displayAnalyser,
    microphoneAnalyser: { connect: vi.fn() },
    mixedAnalyser: { connect: vi.fn() },
    mixer,
    destination: { connect: vi.fn() },
  } as unknown as CaptureStreams;
  return {
    streams,
    nodes: { oldDisplaySource, displayAnalyser, mixer },
    created,
    oldDisplayTracks,
  };
}

describe("reacquireDisplay", () => {
  it("rewires the new surface into the running graph and drops the old one", async () => {
    const { streams, nodes, created, oldDisplayTracks } = fakeCapture();
    const newVideo = fakeTrack("video", "window");
    const newAudio = fakeTrack("audio");
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: () => Promise.resolve(fakeStream([newVideo, newAudio])),
      },
    });

    const display = await reacquireDisplay(streams);

    expect(getDisplaySurface(display)).toBe("window");
    /* The new audio source feeds the same analyser and mixer as before, so the
       recorder's destination and the transcriber's stream are untouched. */
    expect(created).toHaveLength(1);
    expect(created[0].connect).toHaveBeenCalledWith(nodes.displayAnalyser);
    expect(created[0].connect).toHaveBeenCalledWith(nodes.mixer);
    expect(nodes.oldDisplaySource.disconnect).toHaveBeenCalled();
    expect(oldDisplayTracks.every((track) => track.readyState === "ended")).toBe(
      true,
    );
    expect(streams.display.getVideoTracks()[0]).toBe(newVideo);
    vi.unstubAllGlobals();
  });

  it("refuses a surface that carries no system audio, leaving the meeting alone", async () => {
    const { streams, oldDisplayTracks } = fakeCapture();
    const silent = [fakeTrack("video", "window")];
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: () => Promise.resolve(fakeStream(silent)),
      },
    });

    await expect(reacquireDisplay(streams)).rejects.toBeInstanceOf(
      NoSystemAudioError,
    );
    /* The new stream is discarded, and the meeting keeps the surface it had. */
    expect(silent[0].readyState).toBe("ended");
    expect(oldDisplayTracks.every((track) => track.readyState === "live")).toBe(
      true,
    );
    expect(streams.display.getVideoTracks()[0]).toBe(oldDisplayTracks[0]);
    vi.unstubAllGlobals();
  });
});
