import { levelPercent, rmsLevel } from "./audio/levels";
import {
  CaptureStreams,
  NoSystemAudioError,
  queryMicrophonePermission,
  captureSupport,
  startCapture,
  stopCapture,
} from "./capture/browserCapture";
import {
  TranscriptionController,
  type TranscriptionCallbacks,
  type TranscriptionDiagnostics,
} from "./asr/transcriptionController";
import { DeepgramController } from "./asr/deepgramController";
import { DeepgramStreamingClient } from "./asr/deepgramClient";
import {
  DEEPGRAM_LANGUAGES,
  DEEPGRAM_MODELS,
  describeAsrProvider,
  loadAsrSettings,
  resolveAsrProvider,
  saveAsrSettings,
  type AsrSettings,
} from "./asr/asrSettings";
import type { MeetingTranscriber } from "./asr/types";
import { MeetingRecorder, formatBytes, recordingSupported } from "./audio/recorder";
import { SCREEN_PROMPT, ScreenReader } from "./screen/screenReader";
import { WhisperClient } from "./asr/whisperClient";
import type { TranscriptSegment } from "./transcript/dedup";
import { exportMarkdown } from "./backend/intelligence";
import {
  answerQuestion,
  describeConfiguration,
  describeScreen,
  isConfigured,
  requestNotes,
  supportsVision,
  testConnection,
  type AiConfig,
} from "./intelligence/client";
import { buildAskPrompt, type AskTurn } from "./intelligence/ask";
import {
  ACTIVITY_LABELS,
  describeNotesChange,
  notesShape,
  type AiActivityEntry,
  type AiActivityKind,
} from "./intelligence/activity";
import {
  formatActionItem,
  formatClock,
  hasNotes,
  normalizeResult,
  type IntelligenceResult,
} from "./intelligence/notes";
import {
  getProvider,
  PROVIDERS,
  type ProviderId,
} from "./intelligence/providers";
import {
  clearSessionKey,
  forgetRememberedKey,
  getApiKey,
  hasRememberedKey,
  hasSessionKey,
  loadAiSettings,
  lockRememberedKeys,
  migratePlaintextKeys,
  modelFor,
  rememberApiKey,
  rememberState,
  saveAiSettings,
  setSessionKey,
  toAiConfig,
  unlockRememberedKeys,
} from "./intelligence/settings";
import {
  MIN_PASSPHRASE_LENGTH,
  createVault,
  encryptionAvailable,
  updateVault,
} from "./intelligence/vault";
import {
  deleteMeeting,
  getMeetingAudio,
  listMeetings,
  saveMeeting,
  saveMeetingAudio,
  type MeetingQuestion,
  type MeetingRecord,
} from "./history/db";
import { searchMeetings } from "./history/search";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const startButton = $("start-button") as HTMLButtonElement;
const startIconButton = $("start-icon-button") as HTMLButtonElement;
const pauseIconButton = $("pause-icon-button") as HTMLButtonElement;
const stopIconButton = $("stop-icon-button") as HTMLButtonElement;
const dashboardCount = $("dashboard-count");
const dashboardLatest = $("dashboard-latest");
const pauseButton = $("pause-button") as HTMLButtonElement;
const stopButton = $("stop-button") as HTMLButtonElement;
const livePill = $("live-pill");
const alertBox = $("alert");
const errorText = $("error-text");
const browserSupport = $("browser-support");
const systemAudio = $("system-audio");
const microphonePermission = $("microphone-permission");
const displaySurface = $("display-surface");
const duration = $("duration");
const stateElement = $("transcription-state");
const backendElement = $("backend-choice");
const modelStatus = $("model-status");
const modelProgress = $("model-progress");
const modelHint = $("model-hint");
const backendMode = $("backend-mode") as HTMLSelectElement;
/* Speech-to-text */
const asrProvider = $("asr-provider") as HTMLSelectElement;
const deepgramModel = $("deepgram-model") as HTMLInputElement;
const deepgramModelOptions = $(
  "deepgram-model-options",
) as HTMLDataListElement;
const deepgramLanguage = $("deepgram-language") as HTMLSelectElement;
const deepgramKey = $("deepgram-key") as HTMLInputElement;
const deepgramKeyToggle = $("deepgram-key-toggle") as HTMLButtonElement;
const asrSummary = $("asr-summary");
const recordAudioToggle = $("record-audio") as HTMLInputElement;
const readScreenToggle = $("read-screen") as HTMLInputElement;
const screenStatus = $("screen-status");
/* Live bar (outside every view, so a running meeting stays visible) */
const returnButton = $("return-button") as HTMLButtonElement;
const floatAudioSize = $("float-audio-size");
/* Meeting audio */
const audioNote = $("audio-note");
const audioPlayer = $("audio-player") as HTMLAudioElement;
const audioMeta = $("audio-meta");
const audioDownload = $("audio-download") as HTMLButtonElement;
const asrLocalOnlyNote = $("asr-local-only-note");
const modelReload = $("model-reload") as HTMLButtonElement;
const startLabel = $("start-label");
const transcriptionLag = $("transcription-lag");
const transcriptionLevel = $("transcription-level");
const transcriptionWindows = $("transcription-windows");
const transcriptionStatus = $("transcription-status");
const transcriptOutput = $("transcript-output");
const aiOutput = $("ai-output");
const manualNotes = $("manual-notes") as HTMLTextAreaElement;
const meetingTitleInput = $("meeting-title") as HTMLInputElement;
const privacyMode = $("privacy-mode") as HTMLInputElement;
const backendUrl = $("backend-url") as HTMLInputElement;
const apiToken = $("api-token") as HTMLInputElement;
const historySearch = $("history-search") as HTMLInputElement;
const historyList = $("history-list");
const modelInput = $("model-input") as HTMLInputElement;
const chunkInput = $("chunk-input") as HTMLInputElement;
const overlapInput = $("overlap-input") as HTMLInputElement;
const meterElements = {
  system: { fill: $("system-meter"), value: $("system-meter-value") },
  microphone: {
    fill: $("microphone-meter"),
    value: $("microphone-meter-value"),
  },
  mixed: { fill: $("mixed-meter"), value: $("mixed-meter-value") },
};

/* Shell, navigation and workspace surfaces */
type ViewName = "library" | "prepare" | "workspace" | "settings";
type MeetingState = "idle" | "live" | "completed";

const views: Record<ViewName, HTMLElement> = {
  library: $("view-library"),
  prepare: $("view-prepare"),
  workspace: $("view-workspace"),
  settings: $("view-settings"),
};
const rail = document.querySelector<HTMLElement>(".rail")!;
const railToggle = $("rail-toggle") as HTMLButtonElement;
const railMode = $("rail-mode");
const prepareTitle = $("prepare-title") as HTMLInputElement;
const prepareModel = $("prepare-model");
const modelRowLabel = $("model-row-label");
const backendHint = $("backend-hint");
const deepseekState = $("deepseek-state");
const aiSettings = $("ai-settings");
const testAudioButton = $("test-audio") as HTMLButtonElement;
const liveControls = $("live-controls");
const liveLabel = $("live-label");
const durationLabel = $("duration-label");
const floatDuration = $("float-duration");
const floatMic = $("float-mic");
const floatSystem = $("float-system");
const panel = $("panel");
const panelToggle = $("panel-toggle") as HTMLButtonElement;
const panelClose = $("panel-close") as HTMLButtonElement;
const panelTabs = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".panel-tab"),
);
const panelTranscript = $("panel-transcript");
const panelActivity = $("panel-activity");
const aiActivityList = $("ai-activity");
const aiActivityEmpty = $("ai-activity-empty");
const transcriptList = document.querySelector<HTMLElement>(".transcript-list")!;
const transcriptSearch = $("transcript-search") as HTMLInputElement;
const transcriptAutoscroll = $("transcript-autoscroll") as HTMLButtonElement;
const transcriptCopy = $("transcript-copy") as HTMLButtonElement;
const toasts = $("toasts");
const endDialog = $("end-dialog");
const confirmEnd = $("confirm-end") as HTMLButtonElement;
const cancelEnd = $("cancel-end") as HTMLButtonElement;
const endDialogClose = $("end-dialog-close") as HTMLButtonElement;
const copyNotes = $("copy-notes") as HTMLButtonElement;
const exportNotes = $("export-meeting") as HTMLButtonElement;
const deleteNotes = $("delete-meeting") as HTMLButtonElement;
const retryNotes = $("retry-notes") as HTMLButtonElement;
const finalisePanel = $("finalise");
const finaliseError = $("finalise-error");
const finaliseErrorText = $("finalise-error-text");
const finaliseState = $("finalise-state");
const finaliseProgress = $("finalise-progress");
const notesSkeleton = $("notes-skeleton");
const askForm = $("ask-form") as HTMLFormElement;
const askInput = $("ask-input") as HTMLInputElement;
const askButton = $("ask-button") as HTMLButtonElement;
const askThreadElement = $("ask-thread");
const askHint = $("ask-hint");
const noteFields = {
  summary: $("note-summary") as HTMLTextAreaElement,
  keyPoints: $("note-key-points") as HTMLTextAreaElement,
  decisions: $("note-decisions") as HTMLTextAreaElement,
  actionItems: $("note-action-items") as HTMLTextAreaElement,
  questions: $("note-questions") as HTMLTextAreaElement,
};

/* AI notes settings */
const aiProvider = $("ai-provider") as HTMLSelectElement;
const aiModel = $("ai-model") as HTMLInputElement;
const aiModelLabel = $("ai-model-label");
const aiModelOptions = $("ai-model-options") as HTMLDataListElement;
const aiBaseUrlField = $("ai-base-url-field");
const aiBaseUrl = $("ai-base-url") as HTMLInputElement;
const aiBaseUrlLabel = $("ai-base-url-label");
const aiBaseUrlHint = $("ai-base-url-hint");
const aiKey = $("ai-key") as HTMLInputElement;
const aiRemember = $("remember-keys") as HTMLInputElement;
const aiVault = $("vault");
const aiVaultLabel = $("vault-label");
const aiVaultPass = $("vault-pass") as HTMLInputElement;
const aiVaultPassToggle = $("vault-pass-toggle") as HTMLButtonElement;
const aiVaultAction = $("vault-action") as HTMLButtonElement;
const aiVaultStatus = $("vault-status");
const aiLock = $("vault-lock") as HTMLButtonElement;
/* Speech-to-text test/forget and the settings tabs */
const deepgramTest = $("deepgram-test") as HTMLButtonElement;
const deepgramForget = $("deepgram-forget") as HTMLButtonElement;
const deepgramStatus = $("deepgram-status");
const settingsTabs = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-settings-tab]"),
);
const asrPanel = $("asr-settings");
const notesTab = $("tab-notes") as HTMLButtonElement;
const aiKeyLabel = $("ai-key-label");
const aiKeyToggle = $("ai-key-toggle") as HTMLButtonElement;
const aiProviderSummary = $("ai-provider-summary");
const aiStatus = $("ai-status");
const aiTest = $("ai-test") as HTMLButtonElement;
const aiForget = $("ai-forget") as HTMLButtonElement;
const aiCustom = $("ai-custom");

/** Minimum gap between rolling AI note requests while a meeting runs. */
const ROLLING_INTERVAL_MS = 25_000;

let autoscrollEnabled = true;

/** Which settings tab is showing. Declared with the other state so the boot
    sequence, which renders it, can never run before it is initialised. */
let settingsTab: "stt" | "notes" = "stt";

let capture: CaptureStreams | null = null;
let transcription: MeetingTranscriber | null = null;
let meterTimer: number | null = null;
let durationTimer: number | null = null;
let startedAt: number | null = null;
let meterBuffer = new Uint8Array(1024);
let sessionId = `web-${Date.now().toString(36)}`;
let meetingStartedAt = 0;
let latestSegments: TranscriptSegment[] = [];
let latestGeneratedNotes: Record<string, unknown> = {};
let latestSummary: Record<string, unknown> | null = null;
let lastRollingAt = 0;
let rollingInFlight = false;
let savedMeetings: MeetingRecord[] = [];
let intelligenceTimer: number | null = null;
let meetingTitle = "Untitled meeting";
let recovering = false;

/* ---- Whisper model lifecycle -------------------------------------------
   The model is loaded once, up front, and its worker is kept warm: pressing
   Start never waits for a download, and Start stays disabled until the model
   is actually ready. */
type ModelState = "idle" | "loading" | "ready" | "error";

const DEFAULT_WHISPER_MODEL = "Xenova/whisper-tiny.en";

let whisperClient: WhisperClient | null = null;
let whisperModelId = "";
let whisperLoad: Promise<WhisperClient | null> | null = null;
let modelState: ModelState = "idle";
let modelError = "";
let modelPercent = 0;
let modelReloadTimer: number | null = null;
/** Backend the loaded client actually used. */
let activeBackend: "webgpu" | "wasm" = "wasm";
/** Model time for the last window, separated from queue wait. */
let modelWindowMs = 0;
/** Engine the running meeting actually uses (may differ after a fallback). */
let activeEngine: "local" | "deepgram" = "local";
/** Audio recording for the running meeting. */
let recorder: MeetingRecorder | null = null;
let audioUrl: string | null = null;
let audioBytes = 0;
/** Screen reading for the running meeting. */
let screenReader: ScreenReader | null = null;
let screenNotes: Array<{ atMs: number; text: string }> = [];
let screenErrorShown = false;
/** Changelog of every AI suggestion, oldest first. */
let aiActivity: AiActivityEntry[] = [];
/** Questions asked about this meeting, oldest first. */
let askThread: MeetingQuestion[] = [];
let askingInFlight = false;

/* ---- Speech-to-text engine --------------------------------------------
   Local Whisper stays available always; Deepgram is used when it is selected
   and a key is present, unless local-only mode is on. */
function currentAsrSettings(): AsrSettings {
  return loadAsrSettings();
}

function deepgramKeyValue(): string {
  return getApiKey("deepgram");
}

function effectiveAsrProvider(): "local" | "deepgram" {
  return resolveAsrProvider(currentAsrSettings(), {
    localOnly: privacyMode.checked,
    deepgramKey: deepgramKeyValue(),
  });
}

function syncAsrSettingsUi(): void {
  const settings = currentAsrSettings();
  const key = deepgramKeyValue();
  asrProvider.value = settings.provider;
  deepgramModel.value = settings.deepgramModel;
  if (deepgramKey.value !== key) deepgramKey.value = key;
  const cloud = settings.provider === "deepgram";
  deepgramModel.disabled = !cloud;
  deepgramLanguage.disabled = !cloud;
  deepgramKey.disabled = !cloud;
  deepgramKeyToggle.disabled = !cloud;
  deepgramTest.disabled = !cloud;
  deepgramForget.disabled = !cloud;
  if (!cloud) setDeepgramStatus("");
  recordAudioToggle.checked = settings.recordAudio;
  recordAudioToggle.disabled = !recordingSupported();
  readScreenToggle.checked = settings.readScreen;
  if (!screenStatus.textContent)
    screenStatus.textContent = settings.readScreen
      ? "Screens are read by your AI provider's vision model while a meeting runs."
      : "Shared screens are ignored; the notes use speech only.";
  asrSummary.textContent = describeAsrProvider(settings, {
    localOnly: privacyMode.checked,
    deepgramKey: key,
  });
  asrLocalOnlyNote.classList.toggle("hidden", !privacyMode.checked);
  syncModelState();
}

function syncAsrProviderFromCapture(): void {
  const provider = effectiveAsrProvider();
  if (provider !== "deepgram" && initialSupport.supported)
    void ensureWhisperModel();
}


/**
 * The first inference compiles kernels and measured 17-30s in the browser, so
 * the budget has to cover that or the warm-up is pointless.
 */
const WARMUP_TIMEOUT_MS = 90_000;

function activeModelId(): string {
  return modelInput.value.trim() || DEFAULT_WHISPER_MODEL;
}

/**
 * Compute preference, kept in localStorage because it is a property of the
 * machine (a GPU driver that produces nothing is a real failure mode).
 */
const BACKEND_KEY = "gather.transcription.backend";

function loadBackendMode(): "auto" | "wasm" {
  try {
    /* CPU is the default: the WebGPU path stalled for 30s+ on quiet audio on a
       real GPU, which is worse than being a little slower but reliable. */
    return localStorage.getItem(BACKEND_KEY) === "auto" ? "auto" : "wasm";
  } catch {
    return "wasm";
  }
}

function saveBackendMode(value: "auto" | "wasm"): void {
  try {
    localStorage.setItem(BACKEND_KEY, value);
  } catch {
    /* private mode: the preference simply does not persist */
  }
}

function handleBackend(backend: "webgpu" | "wasm"): void {
  activeBackend = backend;
  backendElement.textContent = `Backend: ${backend.toUpperCase()}`;
  backendHint.textContent =
    backend === "webgpu"
      ? "WebGPU is active — Whisper runs on your GPU."
      : "No WebGPU adapter, so Chrome runs Whisper single-threaded on the CPU (GitHub Pages cannot turn on WebAssembly threads). Updates take a few seconds; the app widens its window to keep up.";
}

/** Loads the model once and reuses it; `reload` discards a broken one. */
async function ensureWhisperModel(
  reload = false,
): Promise<WhisperClient | null> {
  const model = activeModelId();
  if (reload) {
    whisperLoad = null;
    whisperClient?.dispose();
    whisperClient = null;
    modelState = "idle";
  }
  if (whisperClient && whisperModelId === model && modelState === "ready")
    return whisperClient;
  if (whisperLoad) return whisperLoad;
  if (whisperClient && whisperModelId !== model) {
    whisperClient.dispose();
    whisperClient = null;
  }
  whisperLoad = loadWhisperModel(model).finally(() => {
    whisperLoad = null;
  });
  return whisperLoad;
}

async function loadWhisperModel(
  model: string,
): Promise<WhisperClient | null> {
  whisperModelId = model;
  modelState = "loading";
  modelError = "";
  modelPercent = 0;
  syncModelState();
  const client = new WhisperClient({
    model,
    language: "en",
    forceBackend: loadBackendMode() === "wasm" ? "wasm" : undefined,
    onProgress: (progress, status) => {
      modelPercent = progress;
      modelStatus.textContent = status;
      modelProgress.textContent = `${Math.round(progress)}%`;
      syncModelState();
    },
    onBackend: handleBackend,
    onTiming: (ms) => {
      modelWindowMs = ms;
    },
    onError: (message) => {
      modelError = message;
      modelState = "error";
      syncModelState();
    },
  });
  try {
    await client.load();
    /* The model is usable now: never hold the user at a "warming up" screen.
       The first inference compiles kernels, so it runs in the background —
       usually long before a meeting starts — and if the user starts first the
       worker simply finishes it before the first real window. */
    whisperClient = client;
    modelState = "ready";
    modelError = "";
    syncModelState();
    void client.warmUp(WARMUP_TIMEOUT_MS).catch(() => undefined);
    return client;
  } catch (error) {
    client.dispose();
    whisperClient = null;
    modelError =
      error instanceof Error
        ? error.message
        : "The Whisper model could not be loaded.";
    modelState = "error";
    syncModelState();
    return null;
  }
}

/** Keeps the Start button, the setup row and the hint in one state. */
function syncModelState(): void {
  const supported = initialSupport.supported;
  /* With Deepgram selected there is no local model to wait for: the engine is
     ready as soon as a key exists, so Start does not depend on a download. */
  const cloud =
    typeof asrProvider !== "undefined" &&
    asrProvider.value === "deepgram" &&
    Boolean(deepgramKeyValue().trim()) &&
    !privacyMode.checked;
  if (cloud) {
    const settings = currentAsrSettings();
    modelRowLabel.textContent = "Transcription engine";
    prepareModel.textContent = `Deepgram ${settings.deepgramModel} · cloud`;
    startButton.disabled = !supported;
    if (startIconButton) startIconButton.disabled = false;
    modelReload.classList.add("hidden");
    backendElement.textContent = "Cloud streaming";
    backendHint.textContent =
      "Deepgram transcribes as you speak. Audio is streamed to Deepgram while a meeting runs; switch to Local Whisper to keep it on this device.";
    if (startLabel) startLabel.textContent = "Start meeting";
    modelHint.textContent = supported
      ? "Real-time transcription is ready — no model download needed."
      : (initialSupport.reason ?? "Browser capture is unavailable here.");
    return;
  }
  const state =
    modelState === "loading"
      ? `loading ${Math.round(modelPercent)}%`
      : modelState === "ready"
        ? "ready"
        : modelState === "error"
          ? "not loaded"
          : "queued";
  prepareModel.textContent = `${activeModelId()} · ${state}`;
  modelRowLabel.textContent = "Whisper model";
  startButton.disabled = !supported || modelState !== "ready";
  if (startIconButton) startIconButton.disabled = modelState !== "ready";
  modelReload.classList.toggle("hidden", modelState !== "error");
  if (startLabel)
    startLabel.textContent =
      modelState === "loading" ? "Preparing Whisper…" : "Start meeting";
  if (!supported) {
    modelHint.textContent =
      initialSupport.reason ?? "Browser capture is unavailable here.";
    return;
  }
  if (modelState === "loading")
    modelHint.textContent = `Downloading and preparing the Whisper model — ${Math.round(modelPercent)}%. The meeting starts as soon as it is ready.`;
  else if (modelState === "ready")
    modelHint.textContent = "Whisper is loaded and runs entirely in this browser.";
  else if (modelState === "error")
    modelHint.textContent = `${modelError} Use “Reload model” to try again.`;
  else modelHint.textContent = "Whisper will load before the meeting starts.";
}


void queryMicrophonePermission().then((value) => {
  microphonePermission.textContent = value;
});
const initialSupport = captureSupport();
if (!initialSupport.supported) {
  browserSupport.textContent =
    initialSupport.reason ?? "This browser cannot capture display audio.";
  browserSupport.classList.remove("hidden");
  startButton.disabled = true;
  startButton.title =
    initialSupport.reason ?? "Browser capture is unavailable here.";
}
startButton.addEventListener("click", () => void handleStart());
startIconButton.addEventListener("click", () => void handleStart());
stopIconButton.addEventListener("click", () => openEndDialog());
stopButton.addEventListener("click", () => openEndDialog());
/* From the library or settings, jump straight back to the running meeting. */
returnButton.addEventListener("click", () => setView("workspace"));
historySearch.addEventListener("input", () => renderHistory());
manualNotes.addEventListener("input", () => void persistCurrentMeeting());
meetingTitleInput.addEventListener("input", () => {
  meetingTitle = meetingTitleInput.value || "Untitled meeting";
  prepareTitle.value = meetingTitle;
  void persistCurrentMeeting();
});
prepareTitle.addEventListener("input", () => {
  meetingTitle = prepareTitle.value || "Untitled meeting";
  meetingTitleInput.value = meetingTitle;
});

/* Only <button> triggers navigate: <body> also carries data-view for the
   stylesheet, and matching it here would run navigation on every click. */
for (const trigger of document.querySelectorAll<HTMLButtonElement>(
  "button[data-view]",
)) {
  trigger.addEventListener("click", () => {
    const target = trigger.dataset.view as ViewName | undefined;
    if (target === "prepare") {
      prepareTitle.value = meetingTitleInput.value || meetingTitle;
    }
    if (target) setView(target);
  });
}

/** Sidebar width preference, remembered across visits. */
const RAIL_KEY = "gather.rail.collapsed";

function applyRailCollapsed(collapsed: boolean): void {
  rail.classList.toggle("is-collapsed", collapsed);
  railToggle.setAttribute("aria-expanded", String(!collapsed));
  railToggle.setAttribute(
    "aria-label",
    collapsed ? "Expand navigation" : "Collapse navigation",
  );
  railToggle.title = collapsed ? "Expand navigation" : "Collapse navigation";
}

railToggle.addEventListener("click", () => {
  const collapsed = !rail.classList.contains("is-collapsed");
  applyRailCollapsed(collapsed);
  try {
    localStorage.setItem(RAIL_KEY, collapsed ? "1" : "0");
  } catch {
    /* the choice simply does not persist */
  }
});

for (const tab of panelTabs) {
  tab.addEventListener("click", () => {
    setPanelTab(tab.dataset.panel === "activity" ? "activity" : "transcript");
  });
}
panelToggle.addEventListener("click", () => {
  panel.classList.toggle("is-open");
  /* A hidden list cannot be scrolled; pin it when it becomes visible again. */
  if (panel.classList.contains("is-open") && autoscrollEnabled)
    scrollTranscriptToEnd();
});
panelClose.addEventListener("click", () => panel.classList.remove("is-open"));

transcriptSearch.addEventListener("input", () => {
  applyTranscriptFilter();
});
transcriptAutoscroll.addEventListener("click", () => {
  autoscrollEnabled = !autoscrollEnabled;
  syncAutoscrollButton();
  if (autoscrollEnabled) scrollTranscriptToEnd();
});
/* Auto-scroll follows new lines until the reader scrolls back deliberately.
   Only user gestures count: a programmatic scroll, a re-layout or the panel
   opening must never switch it off, which is what used to happen. */
function pauseAutoscrollOnUserScroll(): void {
  if (!autoscrollEnabled) return;
  const atEnd =
    transcriptList.scrollHeight -
      transcriptList.scrollTop -
      transcriptList.clientHeight <
    24;
  if (atEnd) return;
  autoscrollEnabled = false;
  syncAutoscrollButton();
}
transcriptList.addEventListener("wheel", pauseAutoscrollOnUserScroll, {
  passive: true,
});
transcriptList.addEventListener("touchmove", pauseAutoscrollOnUserScroll, {
  passive: true,
});
transcriptList.addEventListener("keydown", (event) => {
  if (["ArrowUp", "PageUp", "Home"].includes(event.key))
    pauseAutoscrollOnUserScroll();
});
/* Dragging the scrollbar is neither a wheel nor a touch event, so a scroll
   event still counts — but ours must not, or auto-scroll would switch itself
   off the moment it scrolled. */
transcriptList.addEventListener("scroll", () => {
  if (pinningToEnd) return;
  pauseAutoscrollOnUserScroll();
});
transcriptCopy.addEventListener("click", () => {
  copyText(
    latestSegments.map((segment) => segment.text).join("\n"),
    "Transcript copied",
  );
});

copyNotes.addEventListener("click", () => {
  copyText(markdownForCurrentMeeting(), "Notes copied as Markdown");
});
exportNotes.addEventListener("click", () => exportMeeting(sessionId));
deleteNotes.addEventListener("click", () => void removeMeeting(sessionId));

confirmEnd.addEventListener("click", () => {
  closeEndDialog();
  void handleStop();
});
cancelEnd.addEventListener("click", closeEndDialog);
endDialogClose.addEventListener("click", closeEndDialog);
endDialog.addEventListener("click", (event) => {
  if (event.target === endDialog) closeEndDialog();
});
retryNotes.addEventListener("click", () => void finaliseNotes());

testAudioButton.addEventListener("click", () => void testAudio());

privacyMode.addEventListener("change", syncPrivacyState);
modelInput.addEventListener("input", () => {
  /* The chosen model is loaded ahead of the meeting, so a typed-in id starts
     a fresh load once the user stops typing. */
  syncPrepareModel();
  if (modelReloadTimer !== null) window.clearTimeout(modelReloadTimer);
  modelReloadTimer = window.setTimeout(() => {
    modelReloadTimer = null;
    if (capture) return; // a live meeting keeps the model it started with
    void ensureWhisperModel(true);
  }, 900);
});
modelReload.addEventListener("click", () => {
  hideError();
  void reloadWhisperModel();
});

/**
 * Reloads the model. During a meeting the fresh client is swapped into the
 * running controller, so a reload can no longer leave it holding a disposed
 * worker that silently returns nothing.
 */
async function reloadWhisperModel(): Promise<void> {
  const client = await ensureWhisperModel(true);
  if (!client) return;
  if (transcription instanceof TranscriptionController) {
    transcription.setClient(client);
    showToast("Whisper model reloaded");
  }
}
backendMode.value = loadBackendMode();
backendMode.addEventListener("change", () => {
  const value = backendMode.value === "wasm" ? "wasm" : "auto";
  saveBackendMode(value);
  void reloadWhisperModel();
});

/* ---- Speech-to-text settings ----------------------------------------- */
for (const model of DEEPGRAM_MODELS) {
  const option = document.createElement("option");
  option.value = model;
  deepgramModelOptions.append(option);
}
for (const language of DEEPGRAM_LANGUAGES) {
  const option = document.createElement("option");
  option.value = language.id;
  option.textContent = language.label;
  deepgramLanguage.append(option);
}

function saveAsrAndSync(): void {
  const settings = currentAsrSettings();
  saveAsrSettings(settings);
  syncAsrSettingsUi();
}

/**
 * Choosing a cloud engine is an explicit decision to send audio off the
 * device, so it turns local-only mode off (the reverse is never automatic).
 */
function allowCloudAudioWhenChosen(): void {
  if (currentAsrSettings().provider !== "deepgram") return;
  if (!deepgramKeyValue().trim() || !privacyMode.checked) return;
  privacyMode.checked = false;
  syncPrivacyState();
  /* Re-render: the summary and the Start button both depend on this. */
  syncAsrSettingsUi();
  showToast("Local-only mode off: Deepgram needs to receive meeting audio");
}

for (const button of settingsTabs) {
  button.addEventListener("click", () => {
    setSettingsTab(
      button.dataset.settingsTab === "notes" ? "notes" : "stt",
    );
  });
}

asrProvider.addEventListener("change", () => {
  const settings = currentAsrSettings();
  settings.provider = asrProvider.value === "local" ? "local" : "deepgram";
  saveAsrSettings(settings);
  syncAsrSettingsUi();
  allowCloudAudioWhenChosen();
  syncAsrProviderFromCapture();
});

deepgramModel.addEventListener("change", () => {
  const settings = currentAsrSettings();
  settings.deepgramModel = deepgramModel.value.trim() || "nova-3";
  saveAsrSettings(settings);
  syncAsrSettingsUi();
});

deepgramLanguage.addEventListener("change", () => {
  const settings = currentAsrSettings();
  settings.language = deepgramLanguage.value || "en";
  saveAsrSettings(settings);
  syncAsrSettingsUi();
});

deepgramKey.addEventListener("input", () => {
  setSessionKey("deepgram", deepgramKey.value);
  syncAsrSettingsUi();
  allowCloudAudioWhenChosen();
});

deepgramKeyToggle.addEventListener("click", () => {
  const showing = deepgramKey.type === "text";
  deepgramKey.type = showing ? "password" : "text";
  deepgramKeyToggle.textContent = showing ? "Show" : "Hide";
  deepgramKeyToggle.setAttribute("aria-pressed", String(!showing));
});

recordAudioToggle.addEventListener("change", () => {
  const settings = currentAsrSettings();
  settings.recordAudio = recordAudioToggle.checked;
  saveAsrSettings(settings);
  showToast(
    recordAudioToggle.checked
      ? "Meeting audio will be saved with each transcript"
      : "Meeting audio will not be saved",
  );
});

readScreenToggle.addEventListener("change", () => {
  const settings = currentAsrSettings();
  settings.readScreen = readScreenToggle.checked;
  saveAsrSettings(settings);
  if (!readScreenToggle.checked) {
    screenReader?.stop();
    screenReader = null;
  }
  screenStatus.textContent = readScreenToggle.checked
    ? "Screens are read by your AI provider's vision model while a meeting runs."
    : "Shared screens are ignored; the notes use speech only.";
});

/* ---- AI notes settings ---------------------------------------------- */
for (const provider of PROVIDERS) {
  const option = document.createElement("option");
  option.value = provider.id;
  option.textContent = provider.label;
  aiProvider.append(option);
}

aiProvider.addEventListener("change", () => {
  const settings = loadAiSettings();
  settings.provider = aiProvider.value as ProviderId;
  saveAiSettings(settings);
  syncAiSettingsUi();
  setAiStatus("");
});

aiModel.addEventListener("change", () => {
  const settings = loadAiSettings();
  settings.models[settings.provider] = aiModel.value.trim();
  saveAiSettings(settings);
  syncAiSettingsUi();
});

aiBaseUrl.addEventListener("change", () => {
  const settings = loadAiSettings();
  const value = aiBaseUrl.value.trim();
  if (value) settings.baseUrls[settings.provider] = value;
  else delete settings.baseUrls[settings.provider];
  saveAiSettings(settings);
  syncAiSettingsUi();
  setAiStatus(
    value ? "Requests will use this base URL." : "Using the provider default.",
  );
});

aiKey.addEventListener("change", () => {
  const provider = loadAiSettings().provider;
  const value = aiKey.value.trim();
  /* Typing a key always arms it for this session; remembering is opt-in. */
  setSessionKey(provider, value);
  if (value && rememberState() === "unlocked") void persistKeysToVault();
  setAiStatus(value ? "Key ready for this session." : "");
  syncAiStatusSummary();
});

/* One vault for every key: the shared checkbox opens the passphrase panel and
   remembers both the speech-to-text and the AI notes key. */
aiRemember.addEventListener("change", () => {
  aiVault.classList.toggle("hidden", !aiRemember.checked);
  if (aiRemember.checked) {
    refreshVaultPanel();
    aiVaultPass.focus();
    return;
  }
  setVaultStatus("");
  if (rememberState() !== "unlocked") return;
  void Promise.all([
    forgetRememberedKey(loadAiSettings().provider),
    forgetRememberedKey("deepgram"),
  ]).then((results) => {
    const erased = results.some((result) => result.erasedVault);
    setVaultStatus(
      erased ? "Vault erased." : "Keys are no longer remembered.",
      "ok",
    );
    syncAiStatusSummary();
  });
});

aiVaultAction.addEventListener("click", () => void runVaultAction());
aiVaultPassToggle.addEventListener("click", () => {
  const hidden = aiVaultPass.type === "password";
  aiVaultPass.type = hidden ? "text" : "password";
  aiVaultPassToggle.textContent = hidden ? "Hide" : "Show";
  aiVaultPassToggle.setAttribute("aria-pressed", String(hidden));
  aiVaultPass.focus();
});
aiVaultPass.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void runVaultAction();
  }
});
aiLock.addEventListener("click", () => {
  lockRememberedKeys();
  /* Locking means "stop using the keys", not just "hide the stored copy". */
  clearSessionKey(loadAiSettings().provider);
  clearSessionKey("deepgram");
  syncAiSettingsUi();
  syncAsrSettingsUi();
  setVaultStatus(
    "Vault locked and the keys cleared from this session. Unlock to use them again.",
    "ok",
  );
  syncAiStatusSummary();
});

aiKeyToggle.addEventListener("click", () => {
  const hidden = aiKey.type === "password";
  aiKey.type = hidden ? "text" : "password";
  aiKeyToggle.textContent = hidden ? "Hide" : "Show";
  aiKeyToggle.setAttribute("aria-pressed", String(hidden));
});

aiForget.addEventListener("click", () => {
  const provider = loadAiSettings().provider;
  clearSessionKey(provider);
  void forgetRememberedKey(provider).then(({ erasedVault }) => {
    syncAiSettingsUi();
    setAiStatus(
      erasedVault
        ? "Key forgotten. The vault was erased because it cannot be edited while locked."
        : "Key forgotten.",
    );
    setVaultStatus("");
    syncAiStatusSummary();
  });
});

/* Speech-to-text tab: its own test and forget, like the notes tab. */
deepgramTest.addEventListener("click", () => void runDeepgramTest());
deepgramForget.addEventListener("click", () => {
  clearSessionKey("deepgram");
  void forgetRememberedKey("deepgram").then(({ erasedVault }) => {
    deepgramKey.value = "";
    syncAsrSettingsUi();
    setDeepgramStatus(
      erasedVault ? "Key forgotten. The vault was erased." : "Key forgotten.",
      "ok",
    );
  });
});

backendUrl.addEventListener("change", () => {
  const settings = loadAiSettings();
  settings.baseUrl = backendUrl.value.trim();
  saveAiSettings(settings);
});

apiToken.addEventListener("change", () => {
  const settings = loadAiSettings();
  settings.serverToken = apiToken.value.trim();
  saveAiSettings(settings);
});

aiTest.addEventListener("click", () => void runConnectionTest());

/* One click from "local-only" to a usable key field. */
/* The preparation screen's "Add key" chip is the way into the notes settings
   now that the AI notes tab only exists while local-only mode is off. */
deepseekState.addEventListener("click", () => {
  if (privacyMode.checked) {
    privacyMode.checked = false;
    syncPrivacyState();
    showToast("Local-only mode off: the notes key sends text to your provider");
  }
  setView("settings");
  setSettingsTab("notes");
  aiKey.focus();
  setAiStatus("Paste your key, then use Test connection.");
});

/* Notes grow with their content so no native resize grip is needed. */
const growableFields = [
  manualNotes,
  ...Object.values(noteFields),
] as HTMLTextAreaElement[];
for (const field of growableFields) {
  field.addEventListener("input", () => autoGrowField(field));
}

void loadHistory();
migratePlaintextKeys();
syncPrivacyState();
syncPrepareModel();
syncAiSettingsUi();
syncAsrSettingsUi();
try {
  applyRailCollapsed(localStorage.getItem(RAIL_KEY) === "1");
} catch {
  applyRailCollapsed(false);
}
/* A key restored from this session means the user already chose a cloud
   engine; do not leave it blocked behind the local-only default. */
allowCloudAudioWhenChosen();
setView("library");
setMeetingState("idle");
syncAutoscrollButton();
/* Load Whisper now rather than after the user has picked a screen: by the
   time a meeting starts the model is normally already in memory. */
if (initialSupport.supported) {
  const preload = () => syncAsrProviderFromCapture();
  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
  };
  if (idleWindow.requestIdleCallback)
    idleWindow.requestIdleCallback(preload, { timeout: 3000 });
  else window.setTimeout(preload, 1200);
}
window.addEventListener("beforeunload", () => {
  void persistCurrentMeeting();
});
window.addEventListener("keydown", (event) => {
  const dialogOpen = !endDialog.classList.contains("hidden");
  if (event.key === "Escape" && dialogOpen) {
    closeEndDialog();
    return;
  }
  if (event.key === "Escape" && capture) void handleStop();
  if (
    event.key === " " &&
    document.activeElement === document.body &&
    capture
  ) {
    event.preventDefault();
    handlePauseResume();
  }
});
pauseButton.addEventListener("click", () => handlePauseResume());
pauseIconButton.addEventListener("click", () => handlePauseResume());

async function handleStart(): Promise<void> {
  startButton.disabled = true;
  hideError();
  try {
    const result = await startCapture();
    capture = result.streams;
    sessionId = `web-${Date.now().toString(36)}`;
    meetingStartedAt = Date.now();
    meetingTitle = meetingTitleInput.value || "Untitled meeting";
    prepareTitle.value = meetingTitle;
    latestSegments = [];
    latestGeneratedNotes = {};
    recovering = false;
    latestSummary = null;
    resetActivity();
    restoreAskThread([]);
    setCaptureStatus(result.status);
    startedAt = Date.now();
    startTimers();
    setView("workspace");
    setMeetingState("live");
    notesSkeleton.classList.remove("hidden");
    setFinaliseState("listening");
    if (!isConfigured(currentAiConfig()))
      finaliseState.textContent = "Add an AI key in Settings to fill these in";
    durationLabel.textContent = "Elapsed";
    for (const field of Object.values(noteFields)) field.value = "";
    growAllFields();
    finaliseError.classList.add("hidden");
    transcriptOutput.textContent = "";
    transcriptList.scrollTop = 0;
    renderTranscriptPlaceholder(
      effectiveAsrProvider() === "deepgram"
        ? "Listening… words appear here as each sentence finishes."
        : modelState === "ready"
          ? "Listening for the first words…"
          : "Loading the English Whisper model locally…",
    );
    liveLabel.textContent = "Recording";
    modelStatus.textContent = modelInput.value;
    /* Every meeting starts pinned to the newest line. */
    autoscrollEnabled = true;
    syncAutoscrollButton();
    transcriptionLevel.textContent = "—";
    transcriptionWindows.textContent = "—";
    transcriptionStatus.textContent = "";
    silentWarned = false;
    wordsWarned = false;
    noWindowsWarned = false;
    throttledWarned = false;
    lastDiagnosticsAt = 0;
    lastSnapshot = null;
    modelWindowMs = 0;
    lastRollingAt = 0;
    rollingInFlight = false;
    syncAiStatusSummary();
    const provider = effectiveAsrProvider();
    const onState = (value: string) => {
      stateElement.textContent = value;
      const loading = /loading|download|connecting/i.test(value);
      notesSkeleton.classList.toggle("hidden", !loading);
      if (!loading && latestSegments.length === 0)
        stateElement.textContent = value;
    };
    const onSegment = (segment: TranscriptSegment, all: TranscriptSegment[]) => {
      latestSegments = all;
      notesSkeleton.classList.add("hidden");
      appendTranscript(all);
      void updateIntelligence();
      void persistCurrentMeeting();
    };
    const onLag = (lag: number) => {
      transcriptionLag.textContent = `${Math.round(lag)} ms`;
    };
    const localCallbacks: TranscriptionCallbacks = {
      onState,
      onSegment,
      onLag,
      onDiagnostics: handleTranscriptionDiagnostics,
      onError: showError,
    };

    if (provider === "deepgram") {
      const cloud: MeetingTranscriber = new DeepgramController(
        {
          apiKey: deepgramKeyValue(),
          model: currentAsrSettings().deepgramModel,
          language: currentAsrSettings().language,
        },
        {
          onState,
          onSegment,
          onLag,
          onError: showError,
          onFatal: (message: string) => void fallBackToLocalTranscription(message),
        },
      );
      transcription = cloud;
      try {
        await cloud.start(capture);
        activeEngine = "deepgram";
        transcriptionLag.textContent = "—";
      } catch (error) {
        /* Starting the cloud engine failed: keep the meeting and use local. */
        await cloud.stop().catch(() => undefined);
        const local = await startLocalTranscription(localCallbacks);
        if (!local) throw error;
        transcription = local;
        activeEngine = "local";
        showError(
          error instanceof Error
            ? `${error.message} Continuing with local Whisper.`
            : "Deepgram could not start. Continuing with local Whisper.",
        );
        await local.start(capture);
      }
    } else {
      const local = await startLocalTranscription(localCallbacks);
      if (!local) {
        throw new Error(
          modelError ||
            "The Whisper model could not be loaded. Use “Reload model” and try again.",
        );
      }
      transcription = local;
      activeEngine = "local";
      await local.start(capture);
    }
    notesSkeleton.classList.add("hidden");
    startButton.classList.add("hidden");
    startIconButton.classList.add("hidden");
    pauseButton.classList.remove("hidden");
    pauseIconButton.classList.remove("hidden");
    stopButton.classList.remove("hidden");
    stopIconButton.classList.remove("hidden");
    livePill.className = "live-pill is-live";
    livePill.textContent =
      activeEngine === "deepgram"
        ? "Transcribing · Deepgram"
        : privacyMode.checked
          ? "Transcribing locally"
          : "Transcribing locally · AI ready";
    startAudioRecording(result.streams);
    startScreenReading(result.streams);
    capture.display
      .getVideoTracks()[0]
      ?.addEventListener(
        "ended",
        () => void handleStop("Screen sharing ended."),
        { once: true },
      );
  } catch (caught) {
    if (transcription) await transcription.stop();
    transcription = null;
    await stopCapture(capture);
    capture = null;
    if (caught instanceof NoSystemAudioError) showError(caught.message);
    else if (
      caught instanceof DOMException &&
      caught.name === "NotSupportedError"
    )
      showError(
        "Display audio capture is unavailable here. Use the latest Chrome or Edge on Windows over localhost or HTTPS.",
      );
    else if (
      caught instanceof DOMException &&
      (caught.name === "NotFoundError" ||
        caught.name === "DevicesNotFoundError")
    ) {
      showError(
        "No capture device was found. Choose Entire Screen and enable Share system audio, then check that a microphone is connected.",
      );
    } else if (
      caught instanceof DOMException &&
      caught.name === "NotAllowedError"
    ) {
      showError(
        "Capture was not allowed. Select a display and allow microphone access to continue.",
      );
      microphonePermission.textContent = await queryMicrophonePermission();
    } else
      showError(
        caught instanceof Error
          ? caught.message
          : "Capture could not be started.",
      );
    stopTimers();
    setMeetingState("idle");
    setView("prepare");
  } finally {
    startButton.disabled = !initialSupport.supported || modelState !== "ready";
  }
}

/** Recent screen descriptions, bounded so a long meeting cannot bloat a prompt. */
function recentScreenNotes(): Array<{ atMs: number; text: string }> {
  return screenNotes.slice(-10);
}

function handlePauseResume(): void {
  if (!transcription) return;
  if (pauseButton.textContent === "Pause") {
    transcription.pause();
    screenReader?.pause();
    pauseButton.textContent = "Resume";
    livePill.textContent = "Paused";
    liveLabel.textContent = "Paused";
    liveControls.classList.add("is-paused");
  } else {
    transcription.resume();
    screenReader?.resume();
    pauseButton.textContent = "Pause";
    livePill.textContent = "Transcribing locally";
    liveLabel.textContent = "Recording";
    liveControls.classList.remove("is-paused");
  }
}

async function handleStop(message?: string): Promise<void> {
  const currentTranscription = transcription;
  transcription = null;
  /* The recorder is stopped before the capture graph is torn down, otherwise
     the last seconds of audio are lost with the tracks. */
  const currentRecorder = recorder;
  recorder = null;
  const recording = currentRecorder ? await currentRecorder.stop() : null;
  screenReader?.stop();
  screenReader = null;
  if (screenStatus) screenStatus.textContent = "";
  if (currentTranscription) await currentTranscription.stop();
  const currentCapture = capture;
  capture = null;
  await stopCapture(currentCapture);
  if (recording) await storeMeetingAudio(sessionId, recording);
  floatAudioSize.classList.add("hidden");
  stopTimers();
  resetMeters();
  startButton.classList.remove("hidden");
  startIconButton.classList.remove("hidden");
  pauseButton.classList.add("hidden");
  pauseIconButton.classList.add("hidden");
  stopButton.classList.add("hidden");
  stopIconButton.classList.add("hidden");
  pauseButton.textContent = "Pause";
  livePill.className = "live-pill";
  livePill.textContent = "Completed";
  liveLabel.textContent = "Recording";
  liveControls.classList.remove("is-paused");
  stateElement.textContent = "Completed · transcript saved locally";
  if (intelligenceTimer !== null) {
    window.clearTimeout(intelligenceTimer);
    intelligenceTimer = null;
  }
  setMeetingState("completed");
  setView("workspace");
  await persistCurrentMeeting();
  if (message) showToast(message);
  await finaliseNotes();
}

/** Request the final notes pass; the local transcript is never at risk. */
async function finaliseNotes(): Promise<void> {
  const hasTranscript = latestSegments.length > 0;
  finaliseError.classList.add("hidden");
  if (privacyMode.checked || !hasTranscript) {
    setFinaliseState("done");
    if (privacyMode.checked)
      showToast("Local-only mode: notes stayed on this device");
    return;
  }
  if (!isConfigured(currentAiConfig())) {
    setFinaliseState("done");
    deepseekState.textContent = vaultIsLockingKeys()
      ? "Unlock vault"
      : "Add key";
    showToast(
      vaultIsLockingKeys()
        ? "Unlock your key vault in Settings to generate AI notes"
        : "Add a provider and key in Settings for AI notes",
    );
    return;
  }
  setFinaliseState("finalising");
  notesSkeleton.classList.remove("hidden");
  try {
    const result = await requestNotes(currentAiConfig(), {
      transcript: fullTranscript(),
      sessionId,
      final: true,
      screenNotes: recentScreenNotes(),
    });
    notesSkeleton.classList.add("hidden");
    applyNotes(result, "final");
    await persistCurrentMeeting();
    setFinaliseState("done");
    showToast("Final notes are ready");
  } catch (error) {
    notesSkeleton.classList.add("hidden");
    setFinaliseState("error");
    const message =
      error instanceof Error
        ? error.message
        : "The AI provider could not generate notes.";
    finaliseErrorText.textContent = `${message} Your transcript is safe and saved locally.`;
    finaliseError.classList.remove("hidden");
    stateElement.textContent = "Transcript saved · AI notes unavailable";
    deepseekState.textContent = "Error";
    logActivity("error", message);
  }
}

async function updateIntelligence(): Promise<void> {
  if (privacyMode.checked || latestSegments.length === 0) return;
  if (!isConfigured(currentAiConfig())) return;
  if (intelligenceTimer !== null) window.clearTimeout(intelligenceTimer);
  /* Rolling notes cost the user real money, so they are throttled rather than
     fired on every transcript segment. */
  const sinceLast = Date.now() - lastRollingAt;
  const delay = Math.max(1200, ROLLING_INTERVAL_MS - sinceLast);
  intelligenceTimer = window.setTimeout(() => {
    void requestLatestIntelligence();
  }, delay);
}

async function requestLatestIntelligence(): Promise<void> {
  if (privacyMode.checked || latestSegments.length === 0) return;
  if (rollingInFlight) return;
  rollingInFlight = true;
  lastRollingAt = Date.now();
  try {
    const result = await requestNotes(currentAiConfig(), {
      transcript: transcriptText(),
      sessionId,
      final: false,
      screenNotes: recentScreenNotes(),
    });
    applyNotes(result, "rolling");
    deepseekState.textContent = "Connected";
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "AI notes are unavailable; local transcription continues.";
    aiOutput.textContent = message;
    stateElement.textContent = "Local transcription active · AI unavailable";
    deepseekState.textContent = "Error";
    logActivity("error", message);
  } finally {
    rollingInFlight = false;
  }
}

/** Shown after this long with every window too quiet to transcribe. */
const SILENCE_WARNING_MS = 8_000;

let silentWarned = false;
let wordsWarned = false;
let noWindowsWarned = false;
let throttledWarned = false;
/** When the transcriber last reported anything at all. */
let lastDiagnosticsAt = 0;
/** Latest counters, or null when the transcriber has never reported. */
let lastSnapshot: TranscriptionDiagnostics | null = null;

/** Level, in percent, with a decimal while it is low enough to read as "0%". */
function formatLevelPercent(value: number): string {
  if (value < 1) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

/**
 * Turns window counters into visible feedback.
 *
 * Every way this pipeline can stall used to look identical — "Listening for the
 * first words…" — so the counters are shown in the transcript panel and each
 * stall mode gets its own, actionable message.
 */
function handleTranscriptionDiagnostics(
  snapshot: TranscriptionDiagnostics,
): void {
  const level = formatLevelPercent(snapshot.level * 100);
  lastDiagnosticsAt = Date.now();
  lastSnapshot = snapshot;
  transcriptionLevel.textContent = level;
  transcriptionWindows.textContent = `${snapshot.transcribed} transcribed · ${snapshot.skippedSilent} too quiet`;
  const liveFor = startedAt === null ? 0 : Date.now() - startedAt;
  const parts = [
    `input ${level}`,
    `heard ${(snapshot.receivedMs / 1000).toFixed(0)}s`,
  ];
  if (modelWindowMs > 0)
    parts.push(`model ${(modelWindowMs / 1000).toFixed(1)}s/window`);
  if (snapshot.transcribed > 0)
    parts.push(`${snapshot.transcribed} window${snapshot.transcribed === 1 ? "" : "s"}`);
  if (snapshot.inFlightMs > 0)
    parts.push(`working ${(snapshot.inFlightMs / 1000).toFixed(1)}s`);
  else if (snapshot.sinceInferenceMs > 0)
    parts.push(`last result ${(snapshot.sinceInferenceMs / 1000).toFixed(0)}s ago`);
  transcriptionStatus.textContent = parts.join(" · ");

  /* 1. Nothing audible at all. */
  if (snapshot.silentMs >= SILENCE_WARNING_MS) {
    if (!silentWarned) {
      silentWarned = true;
      showError(
        `No audio is reaching the transcriber (input level ${level}). Check that you shared Entire Screen with "Share system audio", that the meeting is playing sound, and that your microphone is not muted.`,
      );
    }
    return;
  }
  silentWarned = false;

  /* 2. Healthy level but not a single window produced: the audio never reached
        the transcriber, which points at the capture graph rather than the model. */
  if (
    snapshot.transcribed + snapshot.skippedSilent === 0 &&
    liveFor > 12_000 &&
    !noWindowsWarned
  ) {
    noWindowsWarned = true;
    showError(
      `The microphone is registering audio (${level}) but nothing is reaching the transcriber. Reload the page and start a new meeting; if it repeats, tell me and I will dig into the capture path.`,
    );
  }

  /* 3. An inference that never finishes: Chrome slows hidden tabs down hard, and
        a meeting app is usually in front of this one. */
  if (snapshot.inFlightMs > 30_000) {
    if (!throttledWarned) {
      throttledWarned = true;
      showError(
        `Transcription has been stuck for ${Math.round(snapshot.inFlightMs / 1000)}s. Chrome slows down tabs it cannot see — keep this tab visible (a second screen works) while the meeting records.`,
      );
    }
    return;
  }

  /* 4. Audio is flowing through the model but no words come back. */
  if (latestSegments.length > 0) {
    wordsWarned = false;
    return;
  }
  if (snapshot.transcribed >= 6 && !wordsWarned) {
    wordsWarned = true;
    showError(
      `Audio is reaching the transcriber (level ${level}) but the model has not returned any words. Reload the model on the preparation screen, or set Compute to "CPU only" in Settings.`,
    );
  }
}

/** The recent transcript, for the throttled rolling pass. */
function transcriptText(): string {
  return latestSegments
    .slice(-100)
    .map((segment) => segment.text)
    .join(" ");
}

/**
 * The whole transcript, timestamped.
 *
 * Anything that claims to read the meeting — the final notes and every question
 * — has to see all of it. The rolling pass is the only caller that may work from
 * the recent tail, and that is a cost decision, not a coverage one.
 */
function fullTranscript(): string {
  return latestSegments
    .map((segment) => `[${formatClock(segment.startMs)}] ${segment.text.trim()}`)
    .filter((line) => line.length > 7)
    .join("\n");
}

/**
 * Single place that syncs a fresh result into notes, state and persistence.
 *
 * The change is diffed against the previous notes first, so the activity log
 * can say what actually moved rather than just "notes updated".
 */
function applyNotes(
  result: IntelligenceResult,
  source: "rolling" | "final" = "rolling",
): void {
  const change = describeNotesChange(
    normalizeResult(latestGeneratedNotes),
    result,
  );
  latestGeneratedNotes = { ...result };
  latestSummary = { ...result };
  renderNoteSections(result);
  aiOutput.textContent = formatIntelligence(latestSummary);
  finaliseState.textContent = "Notes just updated";
  syncAskState();
  if (source === "final") logActivity("final", change ?? notesShape(result));
  else if (change) logActivity("notes", change);
}

function currentAiConfig(): AiConfig {
  return toAiConfig(loadAiSettings());
}

async function persistCurrentMeeting(): Promise<void> {
  if (!meetingStartedAt || latestSegments.length === 0) return;
  await saveMeeting({
    id: sessionId,
    title: meetingTitle,
    startedAt: meetingStartedAt,
    durationMs: Date.now() - meetingStartedAt,
    transcript: latestSegments,
    manualNotes: manualNotes.value,
    generatedNotes: latestGeneratedNotes,
    summary: latestSummary,
    updatedAt: Date.now(),
    hasAudio: audioBytes > 0,
    screenNotes: screenNotes.length ? screenNotes : undefined,
    aiActivity: aiActivity.length ? aiActivity : undefined,
    qa: askThread.length ? askThread : undefined,
  });
  await loadHistory();
}

async function loadHistory(): Promise<void> {
  try {
    savedMeetings = await listMeetings();
    dashboardCount.textContent = String(savedMeetings.length);
    dashboardLatest.textContent = savedMeetings[0]?.title ?? "No meetings yet";
    renderHistory();
  } catch {
    historyList.textContent = "Meeting history is unavailable in this browser.";
  }
}

function renderHistory(): void {
  const meetings = searchMeetings(savedMeetings, historySearch.value);
  historyList.textContent = "";
  if (!meetings.length) {
    historyList.append(buildEmptyState());
    return;
  }
  const groups = new Map<string, MeetingRecord[]>();
  for (const meeting of meetings) {
    const label = groupLabel(meeting.updatedAt ?? meeting.startedAt);
    const bucket = groups.get(label);
    if (bucket) bucket.push(meeting);
    else groups.set(label, [meeting]);
  }
  for (const [label, bucket] of groups) {
    const section = document.createElement("section");
    section.className = "meeting-group";
    const heading = document.createElement("h2");
    heading.textContent = label;
    section.append(heading);
    for (const meeting of bucket) section.append(buildMeetingRow(meeting));
    historyList.append(section);
  }
}

function buildEmptyState(): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "empty-state";

  const orbit = document.createElement("div");
  orbit.className = "empty-orbit";
  orbit.setAttribute("aria-hidden", "true");
  orbit.append(
    document.createElement("span"),
    document.createElement("span"),
    document.createElement("span"),
  );

  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = "A clearer way to remember";

  const heading = document.createElement("h2");
  heading.textContent = "Make space for the conversation.";

  const copy = document.createElement("p");
  copy.textContent =
    "Start a meeting and Gather keeps the transcript close while you stay present.";

  const action = document.createElement("button");
  action.type = "button";
  action.className = "btn btn-primary";
  action.innerHTML =
    '<svg class="icon" aria-hidden="true"><use href="#i-plus"></use></svg>';
  action.append("Start a meeting");
  action.addEventListener("click", () => {
    prepareTitle.value = meetingTitleInput.value || meetingTitle;
    setView("prepare");
  });

  wrapper.append(orbit, kicker, heading, copy, action);
  return wrapper;
}

function buildMeetingRow(meeting: MeetingRecord): HTMLElement {
  const row = document.createElement("article");
  row.className = "meeting-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `Open ${meeting.title}`);

  const icon = document.createElement("span");
  icon.className = "row-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = '<svg class="icon"><use href="#i-doc"></use></svg>';

  const copy = document.createElement("div");
  copy.className = "row-copy";
  const title = document.createElement("h3");
  title.textContent = meeting.title;
  const excerpt = document.createElement("p");
  excerpt.textContent =
    meeting.manualNotes.trim() ||
    summarizeMeeting(meeting) ||
    `${meeting.transcript.length} transcript segments`;
  copy.append(title, excerpt);

  const meta = document.createElement("div");
  meta.className = "row-meta";
  const when = document.createElement("span");
  when.textContent = whenLabel(meeting.startedAt);
  const length = document.createElement("span");
  length.textContent = formatDurationMs(meeting.durationMs);
  const flag = document.createElement("span");
  const hasSummary = Boolean(
    meeting.summary ?? Object.keys(meeting.generatedNotes ?? {}).length,
  );
  flag.className = `row-flag${hasSummary ? "" : " is-draft"}`;
  flag.textContent = hasSummary ? "Notes ready" : "Transcript only";
  meta.append(when, length, flag);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  for (const [id, label, href] of [
    ["open", "Open meeting", "#i-doc"],
    ["export", "Export meeting", "#i-download"],
    ["delete", "Delete meeting", "#i-trash"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.dataset[id] = meeting.id;
    button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${href}"></use></svg>`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (id === "open") openMeeting(meeting.id);
      if (id === "export") exportMeeting(meeting.id);
      if (id === "delete") void removeMeeting(meeting.id);
    });
    actions.append(button);
  }

  const open = () => openMeeting(meeting.id);
  row.addEventListener("click", open);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });

  row.append(icon, copy, meta, actions);
  return row;
}

function summarizeMeeting(meeting: MeetingRecord): string {
  const source = meeting.summary ?? meeting.generatedNotes ?? {};
  const summary = source as Record<string, unknown>;
  if (typeof summary.executiveSummary === "string")
    return summary.executiveSummary;
  return meeting.transcript[0]?.text ?? "";
}

async function removeMeeting(id: string): Promise<void> {
  await deleteMeeting(id);
  await loadHistory();
  showToast("Meeting deleted");
  if (id === sessionId) setView("library");
}
function openMeeting(id: string): void {
  const meeting = savedMeetings.find((item) => item.id === id);
  if (!meeting) return;
  sessionId = meeting.id;
  meetingStartedAt = meeting.startedAt;
  meetingTitle = meeting.title;
  meetingTitleInput.value = meeting.title;
  prepareTitle.value = meeting.title;
  manualNotes.value = meeting.manualNotes;
  latestSegments = meeting.transcript;
  latestGeneratedNotes = meeting.generatedNotes;
  latestSummary = meeting.summary;
  recovering = true;
  renderTranscriptPlaceholder("");
  appendTranscript(latestSegments);
  screenNotes = meeting.screenNotes ?? [];
  for (const note of screenNotes) appendScreenNote(note);
  aiActivity = meeting.aiActivity ?? [];
  renderActivity();
  restoreAskThread(meeting.qa ?? []);
  renderNoteSections(
    normalizeResult(meeting.summary ?? meeting.generatedNotes),
    false,
  );
  aiOutput.textContent = formatIntelligence(
    latestSummary ?? latestGeneratedNotes,
  );
  const hasNotes = Boolean(
    meeting.summary ?? Object.keys(meeting.generatedNotes ?? {}).length,
  );
  stateElement.textContent = "Completed · transcript saved locally";
  livePill.className = "live-pill";
  livePill.textContent = "Completed";
  liveLabel.textContent = "Recording";
  liveControls.classList.remove("is-paused");
  durationLabel.textContent = "Duration";
  duration.textContent = formatDuration(Math.round(meeting.durationMs / 1000));
  loadStoredAudio(meeting.id);
  floatDuration.textContent = duration.textContent;
  setFinaliseState(hasNotes ? "done" : "listening");
  if (!hasNotes)
    finaliseState.textContent = privacyMode.checked
      ? "Local-only · no AI notes"
      : "Transcript only";
  setMeetingState("completed");
  setView("workspace");
  growAllFields();
}
function exportMeeting(id: string): void {
  const meeting = savedMeetings.find((item) => item.id === id);
  const record = meeting ?? currentMeetingRecord();
  const blob = new Blob([exportMarkdown(record)], { type: "text/markdown" });
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = `${record.title.replace(/[^a-z0-9]+/gi, "-") || "meeting"}.md`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Markdown export saved");
}
function formatIntelligence(result: Record<string, unknown>): string {
  return [
    `Summary: ${String(result.executiveSummary ?? "")}`,
    "",
    "Key points:",
    ...(Array.isArray(result.keyPoints)
      ? result.keyPoints.map((item) => `- ${item}`)
      : []),
    "",
    "Decisions:",
    ...(Array.isArray(result.decisions)
      ? result.decisions.map((item) => `- ${item}`)
      : []),
    "",
    "Action items:",
    ...(Array.isArray(result.actionItems)
      ? result.actionItems.map(
          (item) =>
            `- ${typeof item === "string" ? item : JSON.stringify(item)}`,
        )
      : []),
    "",
    "Questions:",
    ...(Array.isArray(result.questions)
      ? result.questions.map((item) => `- ${item}`)
      : []),
  ].join("\n");
}

function setCaptureStatus(status: {
  systemAudioReceived: boolean;
  microphonePermission: PermissionState | "unknown";
  displaySurface: string | null;
}): void {
  systemAudio.textContent = status.systemAudioReceived
    ? "Received"
    : "Not received";
  systemAudio.className = `status-value ${status.systemAudioReceived ? "good" : "muted"}`;
  microphonePermission.textContent = status.microphonePermission;
  microphonePermission.className = `status-value ${status.microphonePermission === "granted" ? "good" : "muted"}`;
  displaySurface.textContent = status.displaySurface ?? "Not selected";
  displaySurface.className = `status-value ${status.displaySurface ? "good" : "muted"}`;
}

function startTimers(): void {
  /* Keep the start time: stopTimers() clears it, which used to leave the
     elapsed clock frozen at 00:00 for the whole meeting. */
  const start = startedAt ?? Date.now();
  stopTimers();
  startedAt = start;
  meterTimer = window.setInterval(updateMeters, 100);
  durationTimer = window.setInterval(() => {
    if (startedAt === null) return;
    const elapsed = formatDuration(Math.floor((Date.now() - startedAt) / 1000));
    duration.textContent = elapsed;
    floatDuration.textContent = elapsed;
  }, 250);
}
function stopTimers(): void {
  if (meterTimer !== null) window.clearInterval(meterTimer);
  if (durationTimer !== null) window.clearInterval(durationTimer);
  meterTimer = null;
  durationTimer = null;
  startedAt = null;
  duration.textContent = "00:00";
  floatDuration.textContent = "00:00";
}
function updateMeters(): void {
  if (!capture) return;
  const system = readLevel(capture.displayAnalyser);
  const microphone = readLevel(capture.microphoneAnalyser);
  const mixed = readLevel(capture.mixedAnalyser);
  setMeter("system", system);
  setMeter("microphone", microphone);
  setMeter("mixed", mixed);
  floatMic.style.width = `${microphone}%`;
  floatSystem.style.width = `${system}%`;
  syncTranscriptionStatus(mixed);
  if (recorder?.isRecording) {
    const size = formatBytes(recorder.recordedBytes);
    if (floatAudioSize.textContent !== size) floatAudioSize.textContent = size;
    floatAudioSize.classList.remove("hidden");
  }
}

/**
 * Keeps the transcript panel honest when the transcriber reports nothing at
 * all. Windows are only decided every few seconds, so this heartbeat must not
 * confuse "a slow inference is running" with "no audio ever arrived" — the
 * warning is only for the case where no window has *ever* been produced.
 */
function syncTranscriptionStatus(mixedLevel: number): void {
  if (startedAt === null) return;
  const level = formatLevelPercent(mixedLevel);
  const heardMs = lastSnapshot?.receivedMs ?? 0;
  const heard = `heard ${(heardMs / 1000).toFixed(0)}s`;
  if (Date.now() - lastDiagnosticsAt < 3000) return;
  if (lastSnapshot) {
    const working =
      lastSnapshot.inFlightMs > 0
        ? lastSnapshot.inFlightMs + (Date.now() - lastDiagnosticsAt)
        : 0;
    transcriptionStatus.textContent =
      working > 0
        ? `input ${level} · ${heard} · ${lastSnapshot.transcribed} windows · working ${(working / 1000).toFixed(1)}s`
        : `input ${level} · ${heard} · ${lastSnapshot.transcribed} windows · last result ${(lastSnapshot.sinceInferenceMs / 1000).toFixed(0)}s ago`;
    return;
  }
  transcriptionStatus.textContent = `input ${level} · no windows yet`;
  if (Date.now() - startedAt < 12_000 || noWindowsWarned) return;
  noWindowsWarned = true;
  showError(
    heardMs === 0
      ? `No audio is reaching the transcriber at all (input level ${level}). The microphone or display audio track is not delivering samples — reload the page and start a new meeting.`
      : `The microphone is registering audio (${level}) but no audio is reaching the transcriber. Reload the page and start a new meeting; if it repeats the capture path needs fixing.`,
  );
}
function readLevel(analyser: AnalyserNode): number {
  if (meterBuffer.length !== analyser.fftSize)
    meterBuffer = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(meterBuffer);
  return levelPercent(
    rmsLevel(Float32Array.from(meterBuffer, (sample) => (sample - 128) / 128)),
  );
}
function setMeter(name: keyof typeof meterElements, value: number): void {
  meterElements[name].fill.style.width = `${value}%`;
  /* Quiet inputs would otherwise read as a flat 0%, which looks like a dead
     microphone rather than a low level. */
  meterElements[name].value.textContent = formatLevelPercent(value);
}
function resetMeters(): void {
  for (const name of Object.keys(meterElements) as Array<
    keyof typeof meterElements
  >)
    setMeter(name, 0);
  floatMic.style.width = "0%";
  floatSystem.style.width = "0%";
}
/** How many rows are currently in the transcript list. */
let renderedSegments = 0;

function transcriptRow(segment: TranscriptSegment): HTMLElement {
  const row = document.createElement("div");
  row.className = "transcript-segment";

  const seconds = Math.floor(segment.startMs / 1000);
  const stamp = document.createElement("time");
  stamp.dateTime = `PT${seconds}S`;
  stamp.textContent = formatDuration(seconds);

  const body = document.createElement("div");
  const source = document.createElement("span");
  source.className = "transcript-speaker";
  source.textContent = "Room audio";
  const text = document.createElement("p");
  text.textContent = segment.text;
  body.append(source, text);

  row.append(stamp, body);
  return row;
}

/**
 * Replaces the transcript with an empty state (used before capture starts).
 */
function renderTranscriptPlaceholder(message: string): void {
  transcriptOutput.textContent = "";
  renderedSegments = 0;
  const empty = document.createElement("p");
  empty.className = "transcript-empty";
  empty.textContent = message;
  transcriptOutput.append(empty);
}

/**
 * Shows the empty state before any words arrive (or on opening a saved
 * meeting with no transcript).
 */
function resetTranscript(
  emptyMessage = "Your conversation will appear here once capture starts.",
): void {
  transcriptOutput.textContent = "";
  renderedSegments = 0;
  if (!emptyMessage) return;
  const empty = document.createElement("p");
  empty.className = "transcript-empty";
  empty.textContent = emptyMessage;
  transcriptOutput.append(empty);
}

/**
 * Appends whatever is new and never rewrites what is already on screen.
 *
 * The list used to be rebuilt from the array on every segment, which made text
 * appear to be "replaced" while speaking, and the rebuild also reset the scroll
 * position — which turned auto-scroll off by itself.
 */
function appendTranscript(all: TranscriptSegment[]): void {
  if (all.length < renderedSegments) {
    /* The list was reset (new meeting, or a different one was opened). */
    resetTranscript("");
    renderedSegments = 0;
  }
  const placeholder = transcriptOutput.querySelector(".transcript-empty");
  if (placeholder) placeholder.remove();

  for (let index = renderedSegments; index < all.length; index += 1)
    transcriptOutput.append(transcriptRow(all[index]));
  renderedSegments = all.length;

  applyTranscriptFilter();
  if (autoscrollEnabled) scrollTranscriptToEnd();
}

/** Builds the local (Whisper) engine, loading the model if needed. */
async function startLocalTranscription(
  callbacks: TranscriptionCallbacks,
): Promise<TranscriptionController | null> {
  const client = await ensureWhisperModel();
  if (!client) return null;
  return new TranscriptionController(
    {
      model: activeModelId(),
      chunkDurationMs: clampNumber(chunkInput.value, 2, 30, 6) * 1000,
      overlapMs: clampNumber(overlapInput.value, 0, 10, 2) * 1000,
      /* Only true digital silence should be skipped. This used to be 0.008,
         which is loud enough that quiet meeting audio (a distant laptop
         microphone, system audio at half volume) was dropped window after
         window with no feedback at all. */
      silenceRmsThreshold: 0.0015,
      language: "en",
    },
    callbacks,
    client,
  );
}

/**
 * A cloud failure mid-meeting must not cost the user their transcript: the
 * Deepgram engine is stopped and the local one takes over the same capture.
 */
async function fallBackToLocalTranscription(message: string): Promise<void> {
  if (!capture || !transcription || recovering) return;
  recovering = true;
  try {
    await transcription.stop().catch(() => undefined);
    transcription = null;
    const local = await startLocalTranscription({
      onState: (value) => {
        stateElement.textContent = value;
      },
      onSegment: (segment, all) => {
        latestSegments = all;
        appendTranscript(all);
        void updateIntelligence();
        void persistCurrentMeeting();
      },
      onLag: (lag) => {
        transcriptionLag.textContent = `${Math.round(lag)} ms`;
      },
      onDiagnostics: handleTranscriptionDiagnostics,
      onError: showError,
    });
    if (!local) {
      showError(`${message} Local Whisper is unavailable too.`);
      return;
    }
    transcription = local;
    activeEngine = "local";
    await local.start(capture);
    livePill.textContent = "Transcribing locally";
    showToast(`${message} Switched to local Whisper.`);
  } catch (error) {
    showError(
      error instanceof Error
        ? error.message
        : "Could not switch to local transcription.",
    );
  } finally {
    recovering = false;
  }
}

/* ============================================================
   Meeting audio
   ============================================================ */

/** Starts recording the mixed meeting audio when the setting is on. */
function startAudioRecording(streams: CaptureStreams): void {
  clearAudioNote();
  audioBytes = 0;
  floatAudioSize.classList.add("hidden");
  if (!currentAsrSettings().recordAudio) return;
  if (!recordingSupported()) {
    showToast("This browser cannot record audio. The transcript continues.");
    return;
  }
  const next = new MeetingRecorder();
  if (!next.start(streams.mixed)) {
    showToast("Audio recording could not start. The transcript continues.");
    return;
  }
  recorder = next;
}

async function storeMeetingAudio(
  id: string,
  recording: { blob: Blob; mimeType: string; bytes: number; durationMs: number },
): Promise<void> {
  try {
    await saveMeetingAudio({
      id,
      blob: recording.blob,
      mimeType: recording.mimeType,
      bytes: recording.bytes,
      durationMs: recording.durationMs,
      savedAt: Date.now(),
    });
    audioBytes = recording.bytes;
    showAudioNote(recording.blob, recording.bytes, recording.durationMs);
    showToast(`Meeting audio saved · ${formatBytes(recording.bytes)}`);
  } catch {
    showToast("The audio could not be stored. Your transcript is safe.");
  }
}

function showAudioNote(blob: Blob, bytes: number, durationMs: number): void {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(blob);
  audioPlayer.src = audioUrl;
  audioMeta.textContent = `${formatBytes(bytes)} · ${formatDuration(
    Math.round(durationMs / 1000),
  )}`;
  audioNote.classList.remove("hidden");
}

function clearAudioNote(): void {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
  audioPlayer.removeAttribute("src");
  audioMeta.textContent = "";
  audioNote.classList.add("hidden");
}

/** Shows the stored recording of a saved meeting, when there is one. */
async function loadStoredAudio(id: string): Promise<void> {
  clearAudioNote();
  audioBytes = 0;
  try {
    const stored = await getMeetingAudio(id);
    if (!stored) return;
    audioBytes = stored.bytes;
    showAudioNote(stored.blob, stored.bytes, stored.durationMs);
  } catch {
    /* Audio is a bonus; the transcript is what matters. */
  }
}

audioDownload.addEventListener("click", () => {
  if (!audioUrl) return;
  const anchor = document.createElement("a");
  anchor.href = audioUrl;
  anchor.download = `${meetingTitle.replace(/[^a-z0-9]+/gi, "-") || "meeting"}-audio.webm`;
  anchor.click();
});

/* ============================================================
   Shared screen reading
   ============================================================ */

/** Starts reading the shared screen when a vision provider is configured. */
function startScreenReading(streams: CaptureStreams): void {
  screenNotes = [];
  screenErrorShown = false;
  if (screenStatus) screenStatus.textContent = "";
  if (!currentAsrSettings().readScreen) return;
  /* Local-only mode promises that nothing leaves this device. Screen text can
     only come from a cloud vision model, so screens stay unread rather than
     quietly breaking that promise. */
  if (privacyMode.checked) {
    if (screenStatus)
      screenStatus.textContent =
        "Local-only mode is on, so screens are not read. Turn it off to send them to your AI provider.";
    return;
  }

  const config = currentAiConfig();
  const provider = getProvider(config.provider);
  if (!isConfigured(config)) {
    if (screenStatus)
      screenStatus.textContent =
        "Add an AI provider key to read the shared screen.";
    return;
  }
  if (!supportsVision(provider)) {
    if (screenStatus)
      screenStatus.textContent = `${provider.label} cannot read images; screens are skipped.`;
    return;
  }
  if (streams.display.getVideoTracks().length === 0) return;

  const reader = new ScreenReader({
    describe: (dataUrl) =>
      describeScreen(currentAiConfig(), SCREEN_PROMPT, dataUrl),
    onSummary: (summary) => {
      screenNotes.push(summary);
      appendScreenNote(summary);
      logActivity("screen", summary.text);
      void updateIntelligence();
      void persistCurrentMeeting();
    },
    onStatus: (status) => {
      if (screenStatus) screenStatus.textContent = status;
    },
    onError: (message) => {
      /* Once per meeting: a vision call failing every 25s would be noise. */
      if (screenErrorShown) return;
      screenErrorShown = true;
      showError(`${message} Screen reading is off for this meeting.`);
      logActivity("error", message);
      screenReader?.stop();
      screenReader = null;
    },
  });
  if (!reader.start(streams.display)) {
    showToast("Screen reading needs a shared screen. The transcript continues.");
    return;
  }
  screenReader = reader;
}

function appendScreenNote(note: { atMs: number; text: string }): void {
  const row = document.createElement("div");
  row.className = "transcript-segment transcript-screen";
  const stamp = document.createElement("time");
  const seconds = Math.floor(note.atMs / 1000);
  stamp.dateTime = `PT${seconds}S`;
  stamp.textContent = formatDuration(seconds);
  const body = document.createElement("div");
  const source = document.createElement("span");
  source.className = "transcript-speaker";
  source.textContent = "Shared screen";
  const text = document.createElement("p");
  text.textContent = note.text;
  body.append(source, text);
  row.append(stamp, body);
  const placeholder = transcriptOutput.querySelector(".transcript-empty");
  if (placeholder) placeholder.remove();
  transcriptOutput.append(row);
  applyTranscriptFilter();
  if (autoscrollEnabled) scrollTranscriptToEnd();
}

/* ============================================================
   AI activity changelog
   ============================================================ */

/** Milliseconds since this meeting started, for every AI timestamp. */
function meetingClock(): number {
  return meetingStartedAt ? Date.now() - meetingStartedAt : 0;
}

function activityRow(entry: AiActivityEntry): HTMLElement {
  const row = document.createElement("div");
  row.className = `ai-activity-row is-${entry.kind}`;
  const meta = document.createElement("div");
  meta.className = "ai-activity-meta";
  const stamp = document.createElement("time");
  const seconds = Math.floor(entry.atMs / 1000);
  stamp.dateTime = `PT${seconds}S`;
  stamp.textContent = formatDuration(seconds);
  const kind = document.createElement("span");
  kind.className = "ai-activity-kind";
  kind.textContent = ACTIVITY_LABELS[entry.kind];
  meta.append(stamp, kind);
  const text = document.createElement("p");
  text.textContent = entry.text;
  row.append(meta, text);
  return row;
}

/** Newest first: the newest line must be visible without scrolling. */
function renderActivity(): void {
  aiActivityList.textContent = "";
  if (!aiActivity.length) {
    if (aiActivityEmpty) aiActivityList.append(aiActivityEmpty);
    return;
  }
  for (let index = aiActivity.length - 1; index >= 0; index -= 1)
    aiActivityList.append(activityRow(aiActivity[index]));
}

/** Records one AI update, and keeps the meeting's stored copy in step. */
function logActivity(kind: AiActivityKind, text: string): void {
  const trimmed = text.trim();
  const last = aiActivity[aiActivity.length - 1];
  /* A provider that is down fails on every rolling pass; one row that keeps its
     time current beats a hundred identical ones. */
  if (last && last.kind === kind && last.text === trimmed) {
    last.atMs = meetingClock();
    renderActivity();
    void persistCurrentMeeting();
    return;
  }
  aiActivity.push({ atMs: meetingClock(), kind, text: trimmed });
  renderActivity();
  void persistCurrentMeeting();
}

function resetActivity(): void {
  aiActivity = [];
  renderActivity();
}

/* ============================================================
   Questions about a finished meeting
   ============================================================ */

/** Asking needs a key, a provider that can answer, and notes to answer from. */
function syncAskState(): void {
  const config = currentAiConfig();
  const ready = isConfigured(config) && !privacyMode.checked;
  const notesReady = hasNotes(normalizeResult(latestGeneratedNotes));
  const usable = ready && notesReady && !askingInFlight;
  askInput.disabled = !usable;
  askButton.disabled = !usable;
  if (!askHint) return;
  if (askingInFlight) askHint.textContent = "Answering…";
  else if (privacyMode.checked) askHint.textContent = "Off in local-only mode";
  else if (!isConfigured(config))
    askHint.textContent = "Add an AI key in Settings";
  else if (!notesReady) askHint.textContent = "Unlocks once notes are written";
  else askHint.textContent = "Answered from this meeting only";
}

function askTurnRow(turn: MeetingQuestion): { row: HTMLElement; answer: HTMLElement } {
  const row = document.createElement("div");
  row.className = "ask-turn";
  const question = document.createElement("p");
  question.className = "ask-question";
  question.textContent = turn.question;
  const answer = document.createElement("p");
  answer.className = "ask-answer";
  answer.textContent = turn.answer;
  row.append(question, answer);
  return { row, answer };
}

function renderAskThread(): void {
  askThreadElement.textContent = "";
  for (const turn of askThread) {
    const { row } = askTurnRow(turn);
    askThreadElement.append(row);
  }
}

/** Seed the thread from a stored meeting, after the notes have been restored. */
function restoreAskThread(turns: MeetingQuestion[]): void {
  askThread = turns;
  renderAskThread();
  syncAskState();
}

async function askAboutMeeting(): Promise<void> {
  const question = askInput.value.trim();
  if (!question || askingInFlight) return;
  const config = currentAiConfig();
  if (!isConfigured(config) || privacyMode.checked) {
    showToast("Add an AI key in Settings to ask about a meeting");
    return;
  }

  askInput.value = "";
  const turn: MeetingQuestion = { atMs: meetingClock(), question, answer: "" };
  askThread.push(turn);
  const { row, answer } = askTurnRow(turn);
  answer.classList.add("is-pending");
  answer.textContent = "Reading the transcript…";
  askThreadElement.append(row);
  askingInFlight = true;
  syncAskState();

  try {
    const reply = await answerQuestion(
      config,
      buildAskPrompt(
        {
          transcript: fullTranscript(),
          notes: normalizeResult(latestGeneratedNotes),
          screenNotes: recentScreenNotes(),
        },
        question,
        askThread.slice(0, -1) as AskTurn[],
      ),
    );
    turn.answer = reply;
    answer.classList.remove("is-pending");
    answer.textContent = reply;
    logActivity("question", question);
  } catch (error) {
    /* A failed question is not part of the meeting's record. */
    askThread.pop();
    answer.classList.remove("is-pending");
    answer.classList.add("is-error");
    const message =
      error instanceof Error ? error.message : "The question could not be answered.";
    answer.textContent = message;
    logActivity("error", message);
  } finally {
    askingInFlight = false;
    syncAskState();
  }
}

askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void askAboutMeeting();
});

/* ============================================================
   Shell behaviour
   ============================================================ */

function setView(view: ViewName): void {
  if (!viewIsReachable(view)) {
    showToast("End the meeting to leave the meeting screen");
    return;
  }
  const changed = document.body.dataset.view !== view;
  for (const [name, element] of Object.entries(views))
    element.classList.toggle("hidden", name !== view);
  document.body.dataset.view = view;
  for (const link of document.querySelectorAll<HTMLButtonElement>(
    ".rail-link",
  )) {
    /* Preparing a meeting belongs to the Meetings flow, so it must not light
       up the Settings entry. */
    const active =
      link.dataset.view === view ||
      (view === "prepare" && link.dataset.view === "library") ||
      (view === "workspace" && link.dataset.view === "library");
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  /* Never yank the page to the top unless the view actually changed. */
  if (changed) window.scrollTo(0, 0);
  syncReturnButton();
  /* The prepare screen owns the Start button, so make sure the model is on its
     way (or already loaded) as soon as it is opened. */
  if (view === "prepare" && initialSupport.supported)
    syncAsrProviderFromCapture();
}

function setMeetingState(state: MeetingState): void {
  document.body.dataset.meetingState = state;
  /* A running meeting owns the window: the rail disappears, and the library and
     settings are out of reach until it ends. The bar lives outside the views:
     it tracks the meeting, not the page. */
  document.body.classList.toggle("is-meeting-live", state === "live");
  liveControls.classList.toggle("hidden", state !== "live");
  syncReturnButton();
}

/** Whether a view may be opened while a meeting is running. */
function viewIsReachable(view: ViewName): boolean {
  return document.body.dataset.meetingState !== "live" || view === "workspace";
}

/** Offers a way back to the meeting while it runs on another page. */
function syncReturnButton(): void {
  const live = document.body.dataset.meetingState === "live";
  const onWorkspace = document.body.dataset.view === "workspace";
  returnButton.classList.toggle("hidden", !live || onWorkspace);
}

function setPanelTab(tab: "transcript" | "activity"): void {
  const transcriptActive = tab === "transcript";
  panelTranscript.classList.toggle("hidden", !transcriptActive);
  panelActivity.classList.toggle("hidden", transcriptActive);
  for (const button of panelTabs) {
    const active = button.dataset.panel === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

function syncAutoscrollButton(): void {
  transcriptAutoscroll.classList.toggle("is-on", autoscrollEnabled);
  transcriptAutoscroll.setAttribute("aria-pressed", String(autoscrollEnabled));
}

/** True while we are scrolling the list ourselves. */
let pinningToEnd = false;

function scrollTranscriptToEnd(): void {
  pinningToEnd = true;
  transcriptList.scrollTop = transcriptList.scrollHeight;
  requestAnimationFrame(() => {
    pinningToEnd = false;
  });
}

function applyTranscriptFilter(): void {
  const query = transcriptSearch.value.trim().toLowerCase();
  // The first child may be the empty-state placeholder.
  for (const node of Array.from(transcriptOutput.children)) {
    if (!node.classList.contains("transcript-segment")) continue;
    const matches = !query || node.textContent!.toLowerCase().includes(query);
    node.classList.toggle("hidden", !matches);
    node.classList.toggle("is-match", Boolean(query) && matches);
  }
}

function setFinaliseState(
  state: "listening" | "finalising" | "done" | "error",
): void {
  /* The notes editor stays on screen for the whole meeting. It used to be shown
     only while "finalising", so generated notes were written into a hidden
     panel and never seen. Only the progress strip and the error strip are
     state-dependent. */
  finalisePanel.classList.remove("hidden");
  finalisePanel.setAttribute("aria-hidden", "false");
  finaliseProgress.classList.toggle("hidden", state !== "finalising");
  finaliseError.classList.toggle("hidden", state !== "error");
  if (state === "listening") finaliseState.textContent = "Listening quietly";
  if (state === "finalising") finaliseState.textContent = "Finalising notes…";
  if (state === "done") finaliseState.textContent = "Notes ready to edit";
  if (state === "error") finaliseState.textContent = "Summary unavailable";
}

function renderNoteSections(
  result: IntelligenceResult | null,
  highlight = true,
): void {
  const values: Record<keyof typeof noteFields, string> = {
    summary: result?.executiveSummary ?? "",
    keyPoints: toLines(result?.keyPoints),
    decisions: toLines(result?.decisions),
    actionItems: toLines(result?.actionItems),
    questions: toLines(result?.questions),
  };
  for (const [key, value] of Object.entries(values) as Array<
    [keyof typeof noteFields, string]
  >) {
    const field = noteFields[key];
    if (!value) continue;
    field.value = value;
    if (!highlight) continue;
    const section = field.closest<HTMLElement>(".note-section");
    if (!section) continue;
    section.classList.remove("is-updated");
    void section.offsetWidth;
    section.classList.add("is-updated");
    window.setTimeout(() => section.classList.remove("is-updated"), 1700);
  }
  growAllFields();
}

function toLines(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => formatNoteItem(item))
    .map((item) => (item.startsWith("- ") ? item : `• ${item}`))
    .join("\n");
}

/** Renders strings and the backend's `{owner, description, dueDate}` actions. */
function formatNoteItem(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const description = record.description ?? record.task ?? record.text;
    if (typeof description === "string") {
      const owner = record.owner ?? record.assignee ?? record.who;
      const dueDate = record.dueDate ?? record.due;
      return formatActionItem({
        description,
        owner: typeof owner === "string" ? owner : undefined,
        dueDate: typeof dueDate === "string" ? dueDate : undefined,
      });
    }
  }
  return JSON.stringify(item);
}

function currentMeetingRecord(): MeetingRecord {
  return {
    id: sessionId,
    title: meetingTitleInput.value || meetingTitle,
    startedAt: meetingStartedAt || Date.now(),
    durationMs: Date.now() - (meetingStartedAt || Date.now()),
    transcript: latestSegments,
    manualNotes: manualNotes.value,
    generatedNotes: latestGeneratedNotes,
    summary: latestSummary,
    updatedAt: Date.now(),
    screenNotes: screenNotes.length ? screenNotes : undefined,
    aiActivity: aiActivity.length ? aiActivity : undefined,
    qa: askThread.length ? askThread : undefined,
  };
}

function markdownForCurrentMeeting(): string {
  const record = savedMeetings.find((item) => item.id === sessionId);
  return exportMarkdown(record ?? currentMeetingRecord());
}

async function copyText(text: string, message: string): Promise<void> {
  if (!text.trim()) {
    showToast("Nothing to copy yet");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    showToast("Copy is blocked by this browser");
  }
}

function showToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML =
    '<svg class="icon" aria-hidden="true"><use href="#i-check"></use></svg>';
  toast.append(message);
  toasts.append(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 260);
  }, 3200);
}

function openEndDialog(): void {
  if (!capture) return;
  /* The dialog belongs to the meeting view, so ending from another page first
     brings that view back rather than opening an invisible modal. */
  setView("workspace");
  endDialog.classList.remove("hidden");
  confirmEnd.focus();
}

function closeEndDialog(): void {
  endDialog.classList.add("hidden");
}

async function testAudio(): Promise<void> {
  const permission = await queryMicrophonePermission();
  microphonePermission.textContent = permission;
  microphonePermission.className = `setup-state status-value ${
    permission === "granted" ? "good" : "muted"
  }`;
  if (permission === "granted")
    showToast("Microphone is allowed. Start a meeting to meter audio.");
  else
    showToast(
      "Allow microphone access in the browser bar, then start a meeting.",
    );
}

function syncPrivacyState(): void {
  const local = privacyMode.checked;
  railMode.textContent = local ? "Local-only mode" : "Local capture · v0.1";
  backendUrl.disabled = local;
  apiToken.disabled = local;
  /* The notes settings are only usable once local-only mode is off; the tab
     itself stays visible and explains why. */
  applySettingsTab();
  syncAiStatusSummary();
  syncAskState();
}

/** Which settings tab is showing. */
function setSettingsTab(tab: "stt" | "notes"): void {
  settingsTab = tab;
  applySettingsTab();
}

function applySettingsTab(): void {
  const notesUsable = !privacyMode.checked;
  /* The AI notes tab only exists when local-only mode is off. Turning that mode
     on while the tab is open falls back to the speech-to-text tab. */
  notesTab.classList.toggle("hidden", !notesUsable);
  const tab = settingsTab === "notes" && !notesUsable ? "stt" : settingsTab;
  asrPanel.classList.toggle("hidden", tab !== "stt");
  aiSettings.classList.toggle("hidden", tab !== "notes" || !notesUsable);
  for (const button of settingsTabs) {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

/** Reflect the stored provider/model/key back into the settings controls. */
function syncAiSettingsUi(): void {
  const settings = loadAiSettings();
  const provider = getProvider(settings.provider);
  aiProvider.value = provider.id;
  aiModel.value = modelFor(settings, provider.id);
  aiModel.placeholder = provider.defaultModel;
  aiModelLabel.textContent = provider.modelLabel;
  aiKeyLabel.textContent = provider.keyLabel;
  aiKey.placeholder = provider.keyPlaceholder;
  aiKey.value = getApiKey(provider.id);
  aiKey.type = "password";
  aiKeyToggle.textContent = "Show";
  aiKeyToggle.setAttribute("aria-pressed", "false");
  /* Locked and with no session key means the field really is unusable. */
  const locked = rememberState() === "locked" && !hasSessionKey(provider.id);
  aiKey.disabled = locked;
  aiKey.placeholder = locked
    ? "Unlock the vault to load this key"
    : provider.keyPlaceholder;
  aiProviderSummary.textContent = provider.summary;
  aiCustom.classList.toggle("hidden", provider.id !== "custom");
  syncRememberCheckbox();
  refreshVaultPanel();

  /* Optional endpoint override, offered for the OpenAI-compatible providers. */
  const showsBaseUrl = Boolean(provider.allowsBaseUrl);
  aiBaseUrlField.classList.toggle("hidden", !showsBaseUrl);
  if (showsBaseUrl) {
    aiBaseUrl.value = settings.baseUrls[provider.id] ?? "";
    aiBaseUrl.placeholder = provider.defaultBaseUrl ?? "";
    aiBaseUrlLabel.textContent = `${provider.modelLabel.replace(/ model$/, "")} API base URL (optional)`;
    aiBaseUrlHint.textContent = provider.networkHint
      ? `Leave empty to use ${provider.defaultBaseUrl}. ${provider.networkHint.split(":")[0]}.`
      : `Leave empty to use ${provider.defaultBaseUrl}.`;
  }

  backendUrl.value = settings.baseUrl;
  apiToken.value = settings.serverToken;
  aiModelOptions.textContent = "";
  for (const suggestion of provider.suggestedModels) {
    const option = document.createElement("option");
    option.value = suggestion;
    aiModelOptions.append(option);
  }
  syncAiStatusSummary();
  syncAskState();
}

function setAiStatus(message: string, tone: "ok" | "error" | "" = ""): void {
  aiStatus.textContent = message;
  aiStatus.className = `ai-status${tone ? ` is-${tone}` : ""}`;
}

function setVaultStatus(message: string, tone: "ok" | "error" | "" = ""): void {
  aiVaultStatus.textContent = message;
  aiVaultStatus.className = `ai-status${tone ? ` is-${tone}` : ""}`;
}

/** Keep the passphrase prompt and lock button in step with the vault state. */
function refreshVaultPanel(): void {
  const state = rememberState();
  aiVault.classList.toggle("hidden", !aiRemember.checked);
  aiVaultLabel.textContent =
    state === "unlocked"
      ? "Vault unlocked"
      : state === "locked"
        ? "Unlock your vault"
        : "Create a vault passphrase";
  aiVaultAction.textContent =
    state === "locked"
      ? "Unlock"
      : state === "unlocked"
        ? "Update remembered key"
        : "Save & remember";
  aiVaultPass.placeholder =
    state === "locked"
      ? "Your vault passphrase"
      : `At least ${MIN_PASSPHRASE_LENGTH} characters`;
  aiLock.classList.toggle("hidden", state !== "unlocked");
  /* The passphrase is re-masked whenever the panel is re-rendered. */
  aiVaultPass.type = "password";
  aiVaultPassToggle.textContent = "Show";
  aiVaultPassToggle.setAttribute("aria-pressed", "false");
  if (!encryptionAvailable())
    setVaultStatus(
      "Encryption needs HTTPS or localhost, so remembering a key is unavailable here.",
      "error",
    );
}

/**
 * Reflect stored state into the shared checkbox. Only ever called when the view
 * is (re)rendered — never from a change handler, so it cannot fight the user.
 */
function syncRememberCheckbox(): void {
  const state = rememberState();
  if (state === "locked") {
    aiRemember.checked = true; // contents are unknowable until unlocked
    return;
  }
  if (state === "unlocked") {
    aiRemember.checked =
      hasRememberedKey(loadAiSettings().provider) ||
      hasRememberedKey("deepgram");
    return;
  }
  /* No vault yet: offer to create one as soon as there is a key to store. */
  aiRemember.checked =
    hasSessionKey(loadAiSettings().provider) || hasSessionKey("deepgram");
}

/** The keys that "remember" would store right now. */
function keysToRemember(): Record<string, string> {
  const entries: Record<string, string> = {};
  const aiValue = aiKey.value.trim();
  const speechValue = deepgramKey.value.trim();
  if (aiValue) entries[loadAiSettings().provider] = aiValue;
  if (speechValue) entries.deepgram = speechValue;
  return entries;
}

/** Writes both keys into the already-unlocked vault. */
async function persistKeysToVault(): Promise<void> {
  const entries = keysToRemember();
  if (Object.keys(entries).length === 0) return;
  try {
    await updateVault((stored) => {
      Object.assign(stored, entries);
    });
    setVaultStatus("Remembered keys updated.", "ok");
  } catch (error) {
    setVaultStatus(
      error instanceof Error
        ? error.message
        : "The vault could not be updated.",
      "error",
    );
  }
}

async function runVaultAction(): Promise<void> {
  const passphrase = aiVaultPass.value;
  const state = rememberState();
  const entries = keysToRemember();
  if (state === "none" && Object.keys(entries).length === 0) {
    setVaultStatus("Enter a key first, then remember it.", "error");
    return;
  }
  aiVaultAction.disabled = true;
  setVaultStatus(state === "locked" ? "Unlocking…" : "Encrypting…");
  try {
    if (state === "none") {
      await createVault(entries, passphrase);
      setVaultStatus(
        `Remembered ${Object.keys(entries).length} key(s) on this device.`,
        "ok",
      );
    } else if (state === "locked") {
      await unlockRememberedKeys(passphrase);
      setVaultStatus("Vault unlocked for this session.", "ok");
    } else {
      await persistKeysToVault();
    }
    aiVaultPass.value = "";
    aiKey.value = getApiKey(loadAiSettings().provider);
    syncRememberCheckbox();
    refreshVaultPanel();
    syncAiSettingsUi();
    /* The vault may now hold a Deepgram key that was not readable before. */
    syncAsrSettingsUi();
    allowCloudAudioWhenChosen();
  } catch (error) {
    setVaultStatus(
      error instanceof Error ? error.message : "The vault could not be opened.",
      "error",
    );
  } finally {
    aiVaultAction.disabled = false;
  }
}

/** True when a remembered key exists but this session has not unlocked it. */
function vaultIsLockingKeys(): boolean {
  return rememberState() === "locked" && !getApiKey(loadAiSettings().provider);
}

function setDeepgramStatus(
  message: string,
  tone: "ok" | "error" | "" = "",
): void {
  deepgramStatus.textContent = message;
  deepgramStatus.className = `ai-status${tone ? ` is-${tone}` : ""}`;
}

/** Opens a short Deepgram connection to prove the key and settings work. */
async function runDeepgramTest(): Promise<void> {
  const key = deepgramKeyValue().trim();
  if (!key) {
    setDeepgramStatus("Add your Deepgram key first.", "error");
    return;
  }
  const settings = currentAsrSettings();
  deepgramTest.disabled = true;
  setDeepgramStatus("Contacting Deepgram…");
  const client = new DeepgramStreamingClient({
    apiKey: key,
    model: settings.deepgramModel,
    language: settings.language,
  });
  try {
    await client.connect();
    setDeepgramStatus(
      `Connection works — ${settings.deepgramModel} is streaming-ready.`,
      "ok",
    );
  } catch (error) {
    setDeepgramStatus(
      error instanceof Error
        ? error.message
        : "Deepgram could not be reached.",
      "error",
    );
  } finally {
    await client.close().catch(() => undefined);
    deepgramTest.disabled = false;
  }
}

function syncAiStatusSummary(): void {
  const config = currentAiConfig();
  const ready = isConfigured(config) && !privacyMode.checked;
  deepseekState.textContent = ready
    ? describeConfiguration(config)
    : vaultIsLockingKeys()
      ? "Unlock vault"
      : "Add key";
  deepseekState.classList.toggle("is-configured", ready);
}

async function runConnectionTest(): Promise<void> {
  const config = currentAiConfig();
  if (!isConfigured(config)) {
    setAiStatus("Add a key first.", "error");
    return;
  }
  aiTest.disabled = true;
  setAiStatus("Contacting the provider…");
  try {
    setAiStatus(await testConnection(config), "ok");
    syncAiStatusSummary();
  } catch (error) {
    setAiStatus(
      error instanceof Error
        ? error.message
        : "The provider could not be reached.",
      "error",
    );
  } finally {
    aiTest.disabled = false;
  }
}

function syncPrepareModel(): void {
  syncModelState();
}

function autoGrowField(field: HTMLTextAreaElement): void {
  field.style.height = "auto";
  const minHeight = field.classList.contains("personal-notes") ? 116 : 44;
  field.style.height = `${Math.max(minHeight, field.scrollHeight + 2)}px`;
}

function growAllFields(): void {
  const fields = [manualNotes, ...Object.values(noteFields)];
  for (const field of fields) autoGrowField(field);
}

function groupLabel(timestamp: number): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const delta = start.getTime() - timestamp;
  if (delta < 0) return "Today";
  if (delta < day) return "Yesterday";
  if (delta < day * 7) return "Previous 7 days";
  return "Older";
}

function whenLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes || 0} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function showError(message: string): void {
  errorText.textContent = message;
  alertBox.classList.remove("hidden");
  showToast(message);
}
function hideError(): void {
  errorText.textContent = "";
  alertBox.classList.add("hidden");
}
function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
function clampNumber(
  value: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;
}
