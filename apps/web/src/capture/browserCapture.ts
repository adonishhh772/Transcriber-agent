export type CaptureStreams = {
  display: MediaStream;
  microphone: MediaStream;
  mixed: MediaStream;
  audioContext: AudioContext;
  displaySource: MediaStreamAudioSourceNode;
  microphoneSource: MediaStreamAudioSourceNode;
  displayAnalyser: AnalyserNode;
  microphoneAnalyser: AnalyserNode;
  mixedAnalyser: AnalyserNode;
  mixer: GainNode;
  destination: MediaStreamAudioDestinationNode;
};

export type CaptureStatus = {
  systemAudioReceived: boolean;
  microphonePermission: PermissionState | "unknown";
  displaySurface: string | null;
};

export class NoSystemAudioError extends Error {
  constructor() {
    super(
      "No meeting audio was shared. In the picker, share the meeting window (or Entire Screen) and tick Share system audio — or a browser tab with Share tab audio.",
    );
    this.name = "NoSystemAudioError";
  }
}

/**
 * Chrome's display-capture options, ahead of this project's DOM typings.
 *
 * `DisplayMediaStreamOptions` in the TS lib does not know these yet, so they are
 * declared here rather than cast away at the call site — the shapes are the ones
 * the browser actually reads.
 */
export type DisplayCaptureOptions = DisplayMediaStreamOptions & {
  systemAudio?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  selfBrowserSurface?: "include" | "exclude";
};

/**
 * What the browser is asked for when a meeting starts.
 *
 * Exported because the shape matters — see the test: these options were once
 * nested inside the audio constraints, where the browser silently ignored them.
 */
export function getDisplayMediaConstraints(): DisplayCaptureOptions {
  return {
    /* A hint, not a limit: the picker preselects "Window" so the default is one
       window rather than the whole desktop. Sharing a tab or an entire screen
       stays possible, because a tab is where a web meeting often lives and
       system audio is easiest to capture from a monitor. */
    video: {
      displaySurface: "window",
    } as MediaTrackConstraints,
    audio: true,
    /*
     * These belong at the top level of the options dictionary. They used to sit
     * inside the audio constraints, where the browser ignores them — which left
     * `surfaceSwitching` at its default "include", so the shared surface could
     * be swapped for another one mid-meeting without asking again.
     *
     * - `systemAudio: "include"` offers the "share system audio" checkbox; the
     *   meeting audio comes from the shared surface, so it is required.
     * - `surfaceSwitching: "exclude"` removes the picker's "switch surface"
     *   control: what was picked when the meeting started is the only thing this
     *   app can ever read for that meeting.
     * - `selfBrowserSurface: "exclude"` keeps this app's own tab out of the
     *   picker, so a screen share can never loop back into this page.
     */
    systemAudio: "include",
    surfaceSwitching: "exclude",
    selfBrowserSurface: "exclude",
  };
}

/** True when the user shared an entire monitor rather than one tab or window. */
export function isWholeScreen(surface: string | null): boolean {
  return surface === "monitor";
}

/** Plain-language name for the surface being read. */
export function describeDisplaySurface(surface: string | null): string {
  if (surface === "monitor") return "your whole screen";
  if (surface === "window") return "the shared window";
  if (surface === "browser") return "the shared tab";
  return "the surface you shared";
}

export async function queryMicrophonePermission(): Promise<
  PermissionState | "unknown"
> {
  if (!navigator.permissions?.query) return "unknown";

  try {
    const result = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return result.state;
  } catch {
    return "unknown";
  }
}

export function getDisplaySurface(stream: MediaStream): string | null {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  return settings?.displaySurface ?? null;
}

export function captureSupport(): { supported: boolean; reason?: string } {
  if (
    !window.isSecureContext &&
    location.hostname !== "localhost" &&
    location.hostname !== "127.0.0.1"
  )
    return {
      supported: false,
      reason:
        "Open this app on localhost or HTTPS so the browser can grant capture permission.",
    };
  if (
    !navigator.mediaDevices?.getDisplayMedia ||
    !navigator.mediaDevices?.getUserMedia
  )
    return {
      supported: false,
      reason: "Display and microphone capture are unavailable in this browser.",
    };
  if (typeof AudioContext === "undefined")
    return {
      supported: false,
      reason: "Web Audio is unavailable in this browser.",
    };
  return { supported: true };
}

export async function startCapture(): Promise<{
  streams: CaptureStreams;
  status: CaptureStatus;
}> {
  const support = captureSupport();
  if (!support.supported)
    throw new Error(support.reason ?? "Browser capture is unavailable.");
  const display = await navigator.mediaDevices.getDisplayMedia(
    getDisplayMediaConstraints(),
  );
  const displayAudioTracks = display.getAudioTracks();

  if (displayAudioTracks.length === 0) {
    stopStream(display);
    throw new NoSystemAudioError();
  }

  let microphone: MediaStream;
  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
  } catch (error) {
    stopStream(display);
    throw error;
  }

  try {
    const audioContext = new AudioContext();
    const displaySource = audioContext.createMediaStreamSource(
      new MediaStream(displayAudioTracks),
    );
    const microphoneSource = audioContext.createMediaStreamSource(microphone);
    const mixer = audioContext.createGain();
    const displayAnalyser = createAnalyser(audioContext);
    const microphoneAnalyser = createAnalyser(audioContext);
    const mixedAnalyser = createAnalyser(audioContext);
    const destination = audioContext.createMediaStreamDestination();

    displaySource.connect(displayAnalyser);
    microphoneSource.connect(microphoneAnalyser);
    displaySource.connect(mixer);
    microphoneSource.connect(mixer);
    mixer.connect(mixedAnalyser);
    mixer.connect(destination);

    return {
      streams: {
        display,
        microphone,
        mixed: destination.stream,
        audioContext,
        displaySource,
        microphoneSource,
        displayAnalyser,
        microphoneAnalyser,
        mixedAnalyser,
        mixer,
        destination,
      },
      status: {
        systemAudioReceived: true,
        microphonePermission: "granted",
        displaySurface: getDisplaySurface(display),
      },
    };
  } catch (error) {
    stopStream(display);
    stopStream(microphone);
    throw error;
  }
}

export async function stopCapture(
  capture: CaptureStreams | null,
): Promise<void> {
  if (!capture) return;

  const nodes = [
    capture.displaySource,
    capture.microphoneSource,
    capture.displayAnalyser,
    capture.microphoneAnalyser,
    capture.mixedAnalyser,
    capture.mixer,
    capture.destination,
  ];

  for (const node of nodes) {
    try {
      node.disconnect();
    } catch {
      // A node can already be disconnected during browser shutdown.
    }
  }

  stopStream(capture.display);
  stopStream(capture.microphone);
  stopStream(capture.mixed);

  try {
    await capture.audioContext.close();
  } catch {
    // Closing an already closed context is harmless.
  }
}

function createAnalyser(context: AudioContext): AnalyserNode {
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  return analyser;
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
