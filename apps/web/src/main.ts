import { levelPercent, rmsLevel } from "./audio/levels";
import {
  CaptureStreams,
  NoSystemAudioError,
  queryMicrophonePermission,
  captureSupport,
  describeDisplaySurface,
  getDisplaySurface,
  isWholeScreen,
  reacquireDisplay,
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
  CHUNK_LIMITS,
  OVERLAP_LIMITS,
  describeAsrProvider,
  loadAsrSettings,
  resolveAsrProvider,
  saveAsrSettings,
  type AsrSettings,
} from "./asr/asrSettings";
import type { MeetingTranscriber } from "./asr/types";
import { MeetingRecorder, formatBytes, recordingSupported } from "./audio/recorder";
import {
  SCREEN_PROMPT,
  ScreenReader,
  type ScreenSummary,
} from "./screen/screenReader";
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
  visionModelFor,
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
  describeNotesSource,
  formatActionItem,
  formatClock,
  hasNotes,
  normalizeResult,
  notesSourceText,
  sourceLines,
  NOTE_SECTION_KEYS,
  ROLLING_TRANSCRIPT_LINES,
  type IntelligenceResult,
  type NoteSectionKey,
  type NotesSource,
  type SourceLine,
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
  isVaultUnlocked,
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
const keepScreenImagesToggle = $(
  "keep-screen-images",
) as HTMLInputElement;
const screenStatus = $("screen-status");
/* Live bar (outside every view, so a running meeting stays visible) */
const returnButton = $("return-button") as HTMLButtonElement;
const floatAudioSize = $("float-audio-size");
/* Meeting audio */
const audioNote = $("audio-note");
const audioPlayer = $("audio-player") as HTMLAudioElement;
const audioMeta = $("audio-meta");
const audioDownload = $("audio-download") as HTMLButtonElement;
const modelReload = $("model-reload") as HTMLButtonElement;
const startLabel = $("start-label");
const transcriptionLag = $("transcription-lag");
const transcriptionLevel = $("transcription-level");
const transcriptionWindows = $("transcription-windows");
const transcriptionStatus = $("transcription-status");
const transcriptOutput = $("transcript-output");
const manualNotes = $("manual-notes") as HTMLTextAreaElement;
const meetingTitleInput = $("meeting-title") as HTMLInputElement;
const privacyMode = $("privacy-mode") as HTMLInputElement;
const backendUrl = $("backend-url") as HTMLInputElement;
const apiToken = $("api-token") as HTMLInputElement;
const historySearch = $("history-search") as HTMLInputElement;
const historyList = $("history-list");
const libraryBar = $("library-bar");
const libraryVault = $("library-vault");
const libraryVaultTitle = $("library-vault-title");
const libraryVaultCopy = $("library-vault-copy");
const libraryVaultPass = $("library-vault-pass") as HTMLInputElement;
const libraryVaultToggle = $("library-vault-toggle") as HTMLButtonElement;
const libraryVaultAction = $("library-vault-action") as HTMLButtonElement;
const libraryVaultStatus = $("library-vault-status");
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
const floatScreen = $("float-screen") as HTMLButtonElement;
const floatScreenText = $("float-screen-text");
const floatScreenSep = $("float-screen-sep");
const framePreview = $("frame-preview");
const framePreviewImage = $("frame-preview-image") as HTMLImageElement;
const framePreviewTime = $("frame-preview-time");
const framePreviewText = $("frame-preview-text");
const framePreviewNote = $("frame-preview-note");
const framePreviewClose = $("frame-preview-close") as HTMLButtonElement;
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
const askDock = $("ask-dock");
const askThreadToggle = $("ask-thread-toggle") as HTMLButtonElement;
const noteFields = {
  summary: $("note-summary") as HTMLTextAreaElement,
  keyPoints: $("note-key-points") as HTMLTextAreaElement,
  decisions: $("note-decisions") as HTMLTextAreaElement,
  actionItems: $("note-action-items") as HTMLTextAreaElement,
  questions: $("note-questions") as HTMLTextAreaElement,
};
/* What each section was written from: the title opens it, the panel holds it. */
const noteSourceToggles = new Map<NoteSectionKey, HTMLButtonElement>();
const noteSourcePanels = new Map<NoteSectionKey, HTMLElement>();
for (const key of NOTE_SECTION_KEYS) {
  const toggle = document.querySelector<HTMLButtonElement>(
    `[data-note-source="${key}"]`,
  );
  const panel = document.querySelector<HTMLElement>(
    `[data-note-source-panel="${key}"]`,
  );
  if (toggle) noteSourceToggles.set(key, toggle);
  if (panel) noteSourcePanels.set(key, panel);
}
/* The shared surface can disappear without ending the meeting. */
const surfaceNotice = $("surface-notice");
const surfaceNoticeText = $("surface-notice-text");
const surfaceReshare = $("surface-reshare") as HTMLButtonElement;
const floatReshare = $("float-reshare") as HTMLButtonElement;

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
const cloudSettings = $("cloud-settings");
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
let screenNotes: ScreenSummary[] = [];
let screenErrorShown = false;
/** Changelog of every AI suggestion, oldest first. */
let aiActivity: AiActivityEntry[] = [];
/**
 * Activity rows whose "what it read" panel is open, by index into `aiActivity`.
 * Kept outside the DOM because the log is re-rendered on every new entry.
 */
const openActivitySources = new Set<number>();
/** Questions asked about this meeting, oldest first. */
let askThread: MeetingQuestion[] = [];
let askingInFlight = false;
/**
 * What each notes pass was given, oldest first, and which pass wrote each
 * section. Both are saved with the meeting, so the content behind a summary
 * survives a reload and can be read months later.
 */
let noteSources: NotesSource[] = [];
let noteSourceRef: Partial<Record<NoteSectionKey, number>> = {};
/** True while the shared surface is gone but the meeting is still running. */
let surfaceLost = false;
/** True once the display track has actually ended, rather than been muted. */
let surfaceEnded = false;

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
  keepScreenImagesToggle.checked = settings.keepScreenImages;
  syncScreenHint();
  asrSummary.textContent = describeAsrProvider(settings, {
    localOnly: privacyMode.checked,
    deepgramKey: key,
  });
  syncModelState();
}

/**
 * Names the model that will actually read the screen.
 *
 * Screen reading picks its own vision model per provider, so it keeps working
 * whatever the notes model is — `deepseek-chat` cannot see an image, but
 * `deepseek-flash` can, and the notes model is never asked to. Saying which one
 * is used is the honest answer to "can my model read the screen?".
 */
function syncScreenHint(): void {
  if (!screenStatus) return;
  if (!currentAsrSettings().readScreen) {
    screenStatus.textContent =
      "Shared screens are ignored; the notes use speech only.";
    return;
  }
  const config = currentAiConfig();
  const provider = getProvider(config.provider);
  if (!supportsVision(provider)) {
    screenStatus.textContent = `${provider.label} cannot read images, so screens are skipped. Pick another AI provider to read slides and documents.`;
    return;
  }
  const model = visionModelFor(provider, config);
  const notesModel = config.model || provider.defaultModel;
  const base = `Screens are read by ${model} every ~25 seconds while a meeting runs.`;
  screenStatus.textContent =
    notesModel === model
      ? base
      : `${base} Your notes model (${notesModel}) does not need to support images.`;
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
    if (target === "prepare" && !isVaultUnlocked()) {
      setView("library");
      syncLibraryLock();
      libraryVaultPass.focus();
      return;
    }
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

privacyMode.addEventListener("change", () => {
  saveCaptureSettings({ localOnly: privacyMode.checked });
  syncPrivacyState();
});
modelInput.addEventListener("input", () => {
  /* Remembered as it is typed, so a reload keeps the model that was chosen. */
  saveCaptureSettings({ localModel: modelInput.value.trim() });
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
/* The window and overlap are read when a meeting starts; storing them keeps a
   tuned pair from resetting to 6/2 on every reload. */
chunkInput.addEventListener("change", () =>
  saveCaptureSettings({
    chunkSeconds: clampNumber(
      chunkInput.value,
      CHUNK_LIMITS.min,
      CHUNK_LIMITS.max,
      6,
    ),
  }),
);
overlapInput.addEventListener("change", () =>
  saveCaptureSettings({
    overlapSeconds: clampNumber(
      overlapInput.value,
      OVERLAP_LIMITS.min,
      OVERLAP_LIMITS.max,
      2,
    ),
  }),
);
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

/** Saves a change to one of the capture choices without disturbing the rest. */
function saveCaptureSettings(patch: Partial<AsrSettings>): void {
  saveAsrSettings({ ...currentAsrSettings(), ...patch });
}

/**
 * Seeds the capture controls from what was stored.
 *
 * Local-only mode, the Whisper model and the window/overlap used to live only
 * in the markup, so every reload silently put them back to their defaults and
 * the choice had to be made again. They are read once, before anything renders
 * from them.
 */
function applyStoredCaptureSettings(): void {
  const settings = currentAsrSettings();
  privacyMode.checked = settings.localOnly;
  modelInput.value = settings.localModel;
  chunkInput.value = String(settings.chunkSeconds);
  overlapInput.value = String(settings.overlapSeconds);
}

/**
 * Choosing a cloud engine is an explicit decision to send audio off the
 * device, so it turns local-only mode off (the reverse is never automatic).
 */
function allowCloudAudioWhenChosen(): void {
  if (currentAsrSettings().provider !== "deepgram") return;
  if (!deepgramKeyValue().trim() || !privacyMode.checked) return;
  privacyMode.checked = false;
  /* Stored, so the next reload does not arm local-only mode again and block the
     cloud engine the user just chose. */
  saveCaptureSettings({ localOnly: false });
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
  syncScreenHint();
});

keepScreenImagesToggle.addEventListener("change", () => {
  const settings = currentAsrSettings();
  settings.keepScreenImages = keepScreenImagesToggle.checked;
  saveAsrSettings(settings);
  if (keepScreenImagesToggle.checked) syncScreenHint();
  else
    showToast("Captures from now on are text only; earlier frames stay saved");
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
    const needsUnlock = results.some((result) => result.needsUnlock);
    setVaultStatus(
      needsUnlock
        ? "Unlock the vault to forget these keys. Saved meetings use the same vault, so it is not erased while locked."
        : "Keys are no longer remembered.",
      needsUnlock ? "error" : "ok",
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
  /* Locking means "stop using the keys", not just "hide the stored copy".
     Meetings are sealed with the same key, so the library locks too. */
  clearSessionKey(loadAiSettings().provider);
  clearSessionKey("deepgram");
  syncAiSettingsUi();
  syncAsrSettingsUi();
  setVaultStatus(
    "Vault locked and the keys cleared from this session. Unlock to use them again.",
    "ok",
  );
  syncAiStatusSummary();
  void loadHistory();
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
  void forgetRememberedKey(provider).then(({ needsUnlock }) => {
    syncAiSettingsUi();
    setAiStatus(
      needsUnlock
        ? "Unlock the vault to forget this key. Saved meetings use the same vault, so it is not erased while locked."
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
  void forgetRememberedKey("deepgram").then(({ needsUnlock }) => {
    deepgramKey.value = "";
    syncAsrSettingsUi();
    setDeepgramStatus(
      needsUnlock
        ? "Unlock the vault to forget this key. Saved meetings use the same vault, so it is not erased while locked."
        : "Key forgotten.",
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
/* The stored choices are applied first: the privacy switch, the model and the
   window are all read by what renders below. */
applyStoredCaptureSettings();
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
/* The recording bar grows and wraps as its content changes — a screen capture
   appears, the audio size shows up — so the ask bar above it follows whatever
   height it ends up with rather than a number guessed here. */
if (typeof ResizeObserver !== "undefined")
  new ResizeObserver(() => syncAskDockOffset()).observe(liveControls);
window.addEventListener("resize", syncAskDockOffset);
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
  /* Escape closes the frame preview before anything else: without this it would
     also end the meeting, because that is what Escape does while capturing. */
  if (event.key === "Escape" && !framePreview.classList.contains("hidden")) {
    closeFramePreview();
    return;
  }
  /* Escape asks before ending a meeting: a stray keypress used to stop the
     recording outright, and a meeting must only end when the user says so. */
  if (event.key === "Escape" && capture) openEndDialog();
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
  if (!isVaultUnlocked()) {
    setView("library");
    syncLibraryLock();
    setLibraryVaultStatus(
      "Create or unlock your vault before starting a meeting.",
      "error",
    );
    libraryVaultPass.focus();
    return;
  }
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
    resetNotesSources();
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
    /* Losing the share pauses system audio; it never ends the meeting. */
    watchDisplaySurface(result.streams);
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
  /* Text only: a stored thumbnail must never travel in a prompt. */
  return screenNotes
    .slice(-10)
    .map((note) => ({ atMs: note.atMs, text: note.text }));
}

/* ---- Losing the shared surface -----------------------------------------
   A window share ends by itself in ordinary use: Chrome stops capturing a
   window that is closed, pauses one that is minimised, and the browser's own
   "Stop sharing" button ends the track. Every one of those used to end the
   meeting outright and throw the rest of the conversation away. A meeting now
   only ends when the user says so: the microphone keeps recording and
   transcribing, and the user is told what happened and offered a re-share. */

/** Watches the display tracks for the two ways a surface can go away. */
function watchDisplaySurface(streams: CaptureStreams): void {
  watchSharedTrack(streams.display.getVideoTracks()[0], {
    ended:
      "Sharing ended, so meeting audio and screen reading are paused. Your microphone is still recording and transcribing. Use “Share again” to pick the meeting audio back up — or end the meeting when you are ready.",
    muted:
      "Chrome paused the shared surface — a window that was minimised or hidden does this — so meeting audio may be missing. The microphone keeps recording. Share again, or end the meeting when you are ready.",
  });
  /* A share can also lose just its audio, which leaves screen reading working. */
  watchSharedTrack(streams.display.getAudioTracks()[0], {
    ended:
      "The shared audio ended, so meeting audio is paused. Your microphone is still recording and transcribing. Share again to bring the meeting audio back, or end the meeting when you are ready.",
    muted:
      "Chrome paused the shared audio — a window that was minimised or hidden does this. The microphone keeps recording. Share again, or end the meeting when you are ready.",
  });
}

function watchSharedTrack(
  track: MediaStreamTrack | undefined,
  messages: { ended: string; muted: string },
): void {
  if (!track) return;
  track.addEventListener("ended", () => {
    surfaceEnded = true;
    showSurfaceLost(messages.ended);
  });
  track.addEventListener("mute", () => showSurfaceLost(messages.muted));
  track.addEventListener("unmute", () => {
    /* A muted window that comes back is not a lost surface. */
    if (surfaceEnded) return;
    clearSurfaceLost();
  });
}

/** Says plainly that the meeting is still running without shared audio. */
function showSurfaceLost(message: string): void {
  if (!capture) return;
  /* A muted window can flicker; only the first loss is worth a toast. */
  const firstTime = !surfaceLost;
  surfaceLost = true;
  surfaceNoticeText.textContent = message;
  surfaceNotice.classList.remove("hidden");
  floatReshare.classList.remove("hidden");
  livePill.textContent = "Recording · no shared audio";
  liveLabel.textContent = "Recording";
  stateElement.textContent = "Still recording · share the meeting window again";
  if (firstTime) showToast("Shared audio stopped — the meeting is still recording");
}

function clearSurfaceLost(): void {
  surfaceLost = false;
  surfaceNotice.classList.add("hidden");
  floatReshare.classList.add("hidden");
  const paused = pauseButton.textContent === "Resume";
  if (paused) {
    livePill.textContent = "Paused";
    stateElement.textContent = "Paused";
    return;
  }
  livePill.textContent =
    activeEngine === "deepgram"
      ? "Transcribing · Deepgram"
      : "Transcribing locally";
  stateElement.textContent =
    activeEngine === "deepgram" ? "Listening (Deepgram)" : "Transcribing locally";
}

/**
 * Re-opens the picker and rewires the new surface into the running meeting.
 *
 * Everything else — the microphone, the recorder, the transcriber — is the
 * same graph it was, so the transcript has no seam where the share changed.
 */
async function shareAgain(): Promise<void> {
  const current = capture;
  if (!current) return;
  surfaceReshare.disabled = true;
  floatReshare.disabled = true;
  try {
    const display = await reacquireDisplay(current);
    surfaceEnded = false;
    clearSurfaceLost();
    watchDisplaySurface(current);
    setCaptureStatus({
      systemAudioReceived: true,
      microphonePermission: "granted",
      displaySurface: getDisplaySurface(display),
    });
    /* Screen reading follows the new surface, keeping everything already read. */
    screenErrorShown = false;
    beginScreenReading(current);
    /* A meeting that was paused stays paused: re-sharing is not a resume. */
    if (pauseButton.textContent === "Resume") screenReader?.pause();
    showToast(
      `Sharing ${describeDisplaySurface(getDisplaySurface(display))} again`,
    );
  } catch (error) {
    if (error instanceof NoSystemAudioError) showError(error.message);
    else if (error instanceof DOMException && error.name === "NotAllowedError")
      showToast("Sharing was cancelled — the microphone keeps recording");
    else
      showError(
        error instanceof Error
          ? `${error.message} The microphone keeps recording.`
          : "That surface could not be shared. The microphone keeps recording.",
      );
    /* The meeting is unaffected either way: the notice stays up. */
    if (!surfaceLost)
      showSurfaceLost(
        "System audio is still missing. Share the meeting window again to bring it back — your microphone keeps recording meanwhile.",
      );
  } finally {
    surfaceReshare.disabled = false;
    floatReshare.disabled = false;
  }
}

surfaceReshare.addEventListener("click", () => void shareAgain());
floatReshare.addEventListener("click", () => void shareAgain());

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

/**
 * Ends the meeting, and the only thing that does.
 *
 * Called from the End meeting button and its confirmation dialog, so nothing
 * the browser or a stray keypress does can end a recording on the user's
 * behalf.
 */
async function handleStop(): Promise<void> {
  const currentTranscription = transcription;
  transcription = null;
  /* The recorder is stopped before the capture graph is torn down, otherwise
     the last seconds of audio are lost with the tracks. */
  const currentRecorder = recorder;
  recorder = null;
  const recording = currentRecorder ? await currentRecorder.stop() : null;
  screenReader?.stop();
  screenReader = null;
  clearScreenCapture();
  /* Back to the resting hint: which model reads the screen, or why none does. */
  syncScreenHint();
  if (currentTranscription) await currentTranscription.stop();
  const currentCapture = capture;
  capture = null;
  await stopCapture(currentCapture);
  /* Ending the meeting is the only thing that clears a lost-surface warning. */
  surfaceLost = false;
  surfaceEnded = false;
  surfaceNotice.classList.add("hidden");
  floatReshare.classList.add("hidden");
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
  stateElement.textContent = latestSegments.length
    ? "Completed · transcript saved locally"
    : "Completed · no speech was transcribed";
  if (intelligenceTimer !== null) {
    window.clearTimeout(intelligenceTimer);
    intelligenceTimer = null;
  }
  setMeetingState("completed");
  setView("workspace");
  await persistCurrentMeeting();
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
    /* Snapshotted before the request: this is what the model is given. */
    const notesSource = captureNotesSource(true);
    const result = await requestNotes(currentAiConfig(), {
      transcript: fullTranscript(),
      sessionId,
      final: true,
      screenNotes: recentScreenNotes(),
    });
    notesSkeleton.classList.add("hidden");
    applyNotes(result, "final", notesSource);
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
    const notesSource = captureNotesSource(false);
    const result = await requestNotes(currentAiConfig(), {
      transcript: transcriptText(),
      sessionId,
      final: false,
      screenNotes: recentScreenNotes(),
    });
    applyNotes(result, "rolling", notesSource);
    deepseekState.textContent = "Connected";
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "AI notes are unavailable; local transcription continues.";
    /* The AI activity log is the AI surface now, so the failure is reported
       there — one row that keeps its timestamp current while the provider is
       down — rather than in a notes panel the document already covers. */
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
 * can say what actually moved rather than just "notes updated". The pass's own
 * inputs travel with it, so every section can say what it was written from.
 */
function applyNotes(
  result: IntelligenceResult,
  source: "rolling" | "final" = "rolling",
  notesSource: NotesSource | null = null,
): void {
  const change = describeNotesChange(
    normalizeResult(latestGeneratedNotes),
    result,
  );
  latestGeneratedNotes = { ...result };
  latestSummary = { ...result };
  /* The pass is filed here, so the activity row that reports it can point at
     the exact content it was reading. */
  const passIndex = renderNoteSections(result, true, notesSource);
  finaliseState.textContent = "Notes just updated";
  syncAskState();
  if (source === "final")
    logActivity("final", change ?? notesShape(result), passIndex);
  else if (change) logActivity("notes", change, passIndex);
}

/* ---- What each note section was written from ---------------------------
   A summary is only as good as the material behind it. Every pass records its
   own inputs — which transcript lines and which screen captures it was given —
   so clicking a section title, or a row of the AI activity log, shows the
   content that produced it. The record is a range into the meeting's own
   transcript, which is append-only, so every pass of a meeting is kept. */

/** Section titles the reader has opened, so a fresh pass keeps them open. */
const openNoteSources = new Set<NoteSectionKey>();

/**
 * The meeting's lines, one per segment and in transcript order.
 *
 * Deliberately unfiltered: a pass's range points into this list by index, so
 * dropping a line here would shift every range after it.
 */
function transcriptLines(): SourceLine[] {
  return latestSegments.map((segment) => ({
    atMs: segment.startMs,
    text: segment.text.trim(),
  }));
}

/** Provider · model that answered, for the record. */
function notesProviderLabel(): string {
  const config = currentAiConfig();
  const provider = getProvider(config.provider);
  return `${provider.label} · ${config.model.trim() || provider.defaultModel}`;
}

/** Which speech engine produced the lines the notes were written from. */
function speechEngineLabel(): string {
  return activeEngine === "deepgram" ? "Deepgram" : "Local Whisper";
}

/**
 * Where a pass sits in the meeting: where the material it read ends.
 *
 * Clamped to the last line so that retrying the notes on a meeting reopened
 * days later still says "at 42:10" rather than "at 4318:07".
 */
function notesPassClock(): number {
  const lastEnd = latestSegments.length
    ? latestSegments[latestSegments.length - 1].endMs
    : 0;
  const now = meetingClock();
  return lastEnd ? Math.min(now, lastEnd) : now;
}

/**
 * Snapshots the inputs of one pass.
 *
 * Taken before the request is sent: the record has to say what the model was
 * actually given, not what happened to be on screen when the answer arrived.
 * A rolling pass reads the same recent window the prompt does; the final pass
 * reads everything.
 */
function captureNotesSource(final: boolean): NotesSource {
  const total = latestSegments.length;
  return {
    atMs: notesPassClock(),
    final,
    model: notesProviderLabel(),
    engine: speechEngineLabel(),
    from: final ? 0 : Math.max(0, total - ROLLING_TRANSCRIPT_LINES),
    to: total,
    screenNotes: recentScreenNotes(),
  };
}

/** Files one pass and returns its index. */
function recordNotesSource(source: NotesSource): number {
  noteSources.push(source);
  return noteSources.length - 1;
}

/** Forgets every pass: a new meeting starts with nothing behind it. */
function resetNotesSources(): void {
  noteSources = [];
  noteSourceRef = {};
  openNoteSources.clear();
  renderNoteSources();
}

/** Opens or closes the content behind one section. */
function toggleNoteSource(key: NoteSectionKey): void {
  const opening = !openNoteSources.has(key);
  if (opening) openNoteSources.add(key);
  else openNoteSources.delete(key);
  renderNoteSources();
  /* A section near the bottom of the scrolled notes would otherwise open its
     content just out of sight. */
  if (opening) noteSourcePanels.get(key)?.scrollIntoView({ block: "nearest" });
}

/** Paints every section's source panel from the pass it was written by. */
function renderNoteSources(): void {
  for (const key of NOTE_SECTION_KEYS) {
    const panel = noteSourcePanels.get(key);
    const toggle = noteSourceToggles.get(key);
    const section = noteFields[key].closest<HTMLElement>(".note-section");
    if (!panel || !toggle || !section) continue;
    const ref = noteSourceRef[key];
    const source = ref === undefined ? undefined : noteSources[ref];
    const open = openNoteSources.has(key);
    section.classList.toggle("has-source", Boolean(source));
    section.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("hidden", !open);
    panel.textContent = "";
    if (!open) continue;
    panel.append(
      source
        ? buildNoteSource(source)
        : noteSourceEmpty(
            "Nothing has been written from the transcript here yet. Once the AI fills this section, the content it read appears here.",
          ),
    );
  }
}

function noteSourceEmpty(message: string): HTMLElement {
  const empty = document.createElement("p");
  empty.className = "note-source-empty";
  empty.textContent = message;
  return empty;
}

/**
 * One pass's inputs, rendered: what it read, and how to take it away.
 *
 * Shared by the note sections and the AI activity log, so the content behind a
 * summary looks the same wherever it is opened from.
 */
function buildNoteSource(source: NotesSource): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "note-source";
  const head = document.createElement("div");
  head.className = "note-source-head";
  const meta = document.createElement("span");
  meta.className = "note-source-meta";
  meta.textContent = describeNotesSource(source);
  const copy = document.createElement("button");
  copy.className = "btn btn-quiet btn-compact note-source-copy";
  copy.type = "button";
  copy.textContent = "Copy content";
  copy.addEventListener("click", () =>
    void copyText(
      notesSourceText(source, transcriptLines()),
      "Summarised content copied",
    ),
  );
  head.append(meta, copy);

  const body = document.createElement("div");
  body.className = "note-source-body";
  const lines = sourceLines(source, transcriptLines()).filter(
    (line) => line.text.length > 0,
  );
  if (lines.length) {
    for (const line of lines) body.append(sourceLineRow(line));
  } else {
    body.append(
      noteSourceEmpty("Nothing had been transcribed yet when this pass ran."),
    );
  }
  if (source.screenNotes.length) {
    const label = document.createElement("p");
    label.className = "note-source-label";
    label.textContent = "Shared screen";
    body.append(label);
    for (const note of source.screenNotes) body.append(sourceLineRow(note));
  }
  panel.append(head, body);
  return panel;
}

function sourceLineRow(line: SourceLine): HTMLElement {
  const row = document.createElement("div");
  row.className = "note-source-line";
  const seconds = Math.floor(line.atMs / 1000);
  const stamp = document.createElement("time");
  stamp.dateTime = `PT${seconds}S`;
  stamp.textContent = formatClock(line.atMs);
  const text = document.createElement("span");
  text.textContent = line.text;
  row.append(stamp, text);
  return row;
}

for (const [key, toggle] of noteSourceToggles)
  toggle.addEventListener("click", () => toggleNoteSource(key));

function currentAiConfig(): AiConfig {
  return toAiConfig(loadAiSettings());
}

/** A meeting shorter than this, with nothing in it, is not worth a row. */
const MIN_EMPTY_MEETING_MS = 5_000;

/**
 * Saves the running meeting.
 *
 * This used to require at least one transcript segment, which quietly threw away
 * whole meetings: a silent room, a meeting where only slides were shared, or one
 * where somebody typed notes without speaking never reached the library at all.
 * Anything the meeting produced is enough now — words, screen captures, typed
 * notes or audio — and a meeting that simply ran for a while is kept too, so
 * "where did my meeting go?" has one answer.
 */
async function persistCurrentMeeting(): Promise<void> {
  if (!meetingStartedAt) return;
  const durationMs = Date.now() - meetingStartedAt;
  const hasContent =
    latestSegments.length > 0 ||
    screenNotes.length > 0 ||
    manualNotes.value.trim().length > 0 ||
    audioBytes > 0;
  if (!hasContent && durationMs < MIN_EMPTY_MEETING_MS) return;
  try {
    await saveMeeting({
      id: sessionId,
      title: meetingTitle,
      startedAt: meetingStartedAt,
      durationMs,
      transcript: latestSegments,
      manualNotes: manualNotes.value,
      generatedNotes: latestGeneratedNotes,
      summary: latestSummary,
      updatedAt: Date.now(),
      hasAudio: audioBytes > 0,
      screenNotes: screenNotes.length ? screenNotes : undefined,
      aiActivity: aiActivity.length ? aiActivity : undefined,
      qa: askThread.length ? askThread : undefined,
      noteSources: noteSources.length ? noteSources : undefined,
      noteSourceRef: Object.keys(noteSourceRef).length
        ? noteSourceRef
        : undefined,
    });
    await loadHistory();
  } catch (error) {
    /* Silently dropping a meeting is the worst outcome here, so say so. */
    showError(
      `This meeting could not be saved to this browser (${
        error instanceof Error ? error.message : "storage error"
      }). Export it before closing the tab.`,
    );
  }
}

function setLibraryVaultStatus(
  message: string,
  tone: "ok" | "error" | "" = "",
): void {
  libraryVaultStatus.textContent = message;
  libraryVaultStatus.className = `ai-status${tone ? ` is-${tone}` : ""}`;
}

/** Show the passphrase gate whenever meetings cannot be decrypted. */
function syncLibraryLock(): void {
  const locked = !isVaultUnlocked();
  libraryVault.classList.toggle("hidden", !locked);
  libraryBar.classList.toggle("hidden", locked);
  historyList.classList.toggle("hidden", locked);
  if (!locked) return;
  const creating = rememberState() === "none";
  libraryVaultTitle.textContent = creating
    ? "Seal your meetings"
    : "Meetings are locked";
  libraryVaultCopy.textContent = creating
    ? "Meetings stay on this device, encrypted with the same vault as your API keys. Create a passphrase to begin."
    : "Unlock the vault to open saved meetings. The passphrase is the same one that protects your API keys.";
  libraryVaultAction.textContent = creating ? "Create vault" : "Unlock";
  libraryVaultPass.placeholder = creating
    ? `At least ${MIN_PASSPHRASE_LENGTH} characters`
    : "Your vault passphrase";
  if (!encryptionAvailable()) {
    libraryVaultAction.disabled = true;
    setLibraryVaultStatus(
      "Encryption needs HTTPS or localhost, so meetings cannot be saved here.",
      "error",
    );
  }
}

async function runLibraryVaultAction(): Promise<void> {
  const passphrase = libraryVaultPass.value;
  const creating = rememberState() === "none";
  libraryVaultAction.disabled = true;
  setLibraryVaultStatus(creating ? "Encrypting…" : "Unlocking…");
  try {
    if (creating) await createVault({}, passphrase);
    else await unlockRememberedKeys(passphrase);
    libraryVaultPass.value = "";
    setLibraryVaultStatus("");
    syncAiSettingsUi();
    syncAsrSettingsUi();
    await loadHistory();
  } catch (error) {
    setLibraryVaultStatus(
      error instanceof Error ? error.message : "The vault could not be opened.",
      "error",
    );
  } finally {
    libraryVaultAction.disabled = !encryptionAvailable();
  }
}

libraryVaultAction.addEventListener("click", () => void runLibraryVaultAction());
libraryVaultToggle.addEventListener("click", () => {
  const hidden = libraryVaultPass.type === "password";
  libraryVaultPass.type = hidden ? "text" : "password";
  libraryVaultToggle.textContent = hidden ? "Hide" : "Show";
  libraryVaultToggle.setAttribute("aria-pressed", String(hidden));
  libraryVaultPass.focus();
});
libraryVaultPass.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void runLibraryVaultAction();
  }
});

async function loadHistory(): Promise<void> {
  syncLibraryLock();
  if (!isVaultUnlocked()) {
    savedMeetings = [];
    dashboardCount.textContent = "0";
    dashboardLatest.textContent = "Vault locked";
    return;
  }
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
  const query = historySearch.value.trim();
  const meetings = searchMeetings(savedMeetings, historySearch.value);
  historyList.textContent = "";
  if (!meetings.length) {
    /* A filter that hides everything must not look like an empty library: that
       is how a saved meeting appears to have vanished. */
    historyList.append(
      query ? buildNoMatchesState(query) : buildEmptyState(),
    );
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
    if (!isVaultUnlocked()) {
      syncLibraryLock();
      libraryVaultPass.focus();
      return;
    }
    prepareTitle.value = meetingTitleInput.value || meetingTitle;
    setView("prepare");
  });

  wrapper.append(orbit, kicker, heading, copy, action);
  return wrapper;
}

/** Shown when a search query matches nothing, rather than the welcome state. */
function buildNoMatchesState(query: string): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "empty-state";

  const heading = document.createElement("h2");
  heading.textContent = `No meeting matches “${query}”.`;

  const copy = document.createElement("p");
  const total = savedMeetings.length;
  copy.textContent = total
    ? `${total} saved ${total === 1 ? "meeting is" : "meetings are"} hidden by this search.`
    : "Nothing has been saved in this browser yet.";

  const action = document.createElement("button");
  action.type = "button";
  action.className = "btn btn-quiet";
  action.innerHTML =
    '<svg class="icon" aria-hidden="true"><use href="#i-x"></use></svg>';
  action.append("Clear search");
  action.addEventListener("click", () => {
    historySearch.value = "";
    renderHistory();
  });

  wrapper.append(heading, copy, action);
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
    describeEmptyMeeting(meeting);
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
  const hasTranscript = meeting.transcript.length > 0;
  flag.className = `row-flag${hasSummary ? "" : " is-draft"}`;
  flag.textContent = hasSummary
    ? "Notes ready"
    : hasTranscript
      ? "Transcript only"
      : "Nothing captured";
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

/**
 * What to say about a meeting with no words of its own.
 *
 * "0 transcript segments" told the user nothing; a meeting that only shared a
 * screen, or only kept audio, should say exactly that.
 */
function describeEmptyMeeting(meeting: MeetingRecord): string {
  const parts: string[] = [];
  const captures = meeting.screenNotes?.length ?? 0;
  if (captures === 1) parts.push("1 screen capture");
  else if (captures > 1) parts.push(`${captures} screen captures`);
  if (meeting.hasAudio) parts.push("audio kept");
  if (parts.length)
    return `No speech transcribed · ${parts.join(" · ")}`;
  return "No speech was transcribed in this meeting";
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
  renderTranscriptPlaceholder(
    latestSegments.length
      ? ""
      : "No speech was transcribed in this meeting.",
  );
  appendTranscript(latestSegments);
  screenNotes = meeting.screenNotes ?? [];
  for (const note of screenNotes) appendScreenNote(note);
  aiActivity = meeting.aiActivity ?? [];
  restoreAskThread(meeting.qa ?? []);
  /* The passes come back before anything that reads them renders: the notes
     sections, and the activity rows that show what a pass was given. */
  noteSources = meeting.noteSources ?? [];
  noteSourceRef = meeting.noteSourceRef ?? {};
  openNoteSources.clear();
  openActivitySources.clear();
  renderActivity();
  /* A re-shared surface is not a state an opened meeting is in. */
  surfaceLost = false;
  surfaceEnded = false;
  surfaceNotice.classList.add("hidden");
  floatReshare.classList.add("hidden");
  renderNoteSections(
    normalizeResult(meeting.summary ?? meeting.generatedNotes),
    false,
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
  holdMeetingLock();
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
  releaseMeetingLock();
}

/**
 * Resolves the held Web Lock, which ends the hold.
 *
 * Held for exactly as long as a meeting runs: `meetingLockWanted` says whether
 * the meeting still wants it, because the lock may only be granted after the
 * meeting has already ended.
 */
let endMeetingLock: (() => void) | null = null;
let meetingLockWanted = false;

/**
 * Keeps Chrome from freezing this hidden tab while a meeting runs.
 *
 * Freezing stops every timer and callback in the page, which for this app means
 * the meters, the recorder and the transcriber all stop — and it looks exactly
 * like the transcript dying on its own during a quiet stretch, because a quiet
 * stretch is when nobody is looking at this tab. Chromium's own list of pages it
 * will not freeze includes one that "is currently holding a Web Lock", so the
 * running meeting holds one; it also covers the state after the shared surface
 * is lost, when this page is no longer capturing a screen. Freezing needs no
 * opt-in from the app to be avoided, and the hold is dropped the moment the
 * meeting ends.
 *
 * See chrome/browser/performance_manager/docs/freezing_opt_out_opt_in.md.
 */
function holdMeetingLock(): void {
  if (meetingLockWanted) return;
  const locks = navigator.locks;
  if (!locks?.request) return;
  meetingLockWanted = true;
  void locks
    .request(
      "gather-meeting-active",
      () =>
        new Promise<void>((resolve) => {
          endMeetingLock = resolve;
          /* The meeting ended before the lock was granted. */
          if (!meetingLockWanted) resolve();
        }),
    )
    .catch(() => undefined)
    .finally(() => {
      endMeetingLock = null;
    });
}

/** Drops the hold: the meeting is over and the tab may sleep again. */
function releaseMeetingLock(): void {
  meetingLockWanted = false;
  endMeetingLock?.();
  endMeetingLock = null;
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
  /* With nothing to append, an explanatory line is all the panel has. */
  const placeholder = transcriptOutput.querySelector(".transcript-empty");
  if (placeholder && all.length > 0) placeholder.remove();

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
  clearScreenCapture();
  if (screenStatus) screenStatus.textContent = "";
  beginScreenReading(streams);
}

/**
 * Attaches a reader to the current shared surface.
 *
 * Split out of `startScreenReading` because re-sharing a surface has to start a
 * reader without throwing away what the previous surface already showed.
 */
function beginScreenReading(streams: CaptureStreams): void {
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
    /* The thumbnail is the only screen picture that is written down, so it is
       opt-out rather than always-on. */
    thumbnails: currentAsrSettings().keepScreenImages,
    /* Meeting-relative, so a re-shared surface does not restart the clock. */
    clock: meetingClock,
    describe: (dataUrl) =>
      describeScreen(currentAiConfig(), SCREEN_PROMPT, dataUrl),
    onSummary: (summary) => {
      screenNotes.push(summary);
      appendScreenNote(summary);
      showScreenCapture(summary);
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
  /* The previous surface's reader, if any, is done: its frames are gone. */
  screenReader?.stop();
  screenReader = reader;
  /* Say exactly what is being read. The app only ever sees the one surface the
     browser handed over, so naming it is the honest answer to "what can it
     see?" — and a whole monitor deserves a warning. */
  const surface = getDisplaySurface(streams.display);
  const where = describeDisplaySurface(surface);
  if (isWholeScreen(surface)) {
    if (screenStatus)
      screenStatus.textContent = `Reading ${where}: everything on it — other windows included — is visible to the vision model. Share a single window to keep it to the meeting.`;
    showToast(
      "Screen reading sees your whole screen. Share one window next time to keep it to the meeting.",
    );
  } else {
    if (screenStatus)
      screenStatus.textContent = `Reading ${where} every ~25 seconds. Nothing else on your screen is read.`;
    showToast(`Screen reading is limited to ${where}.`);
  }
}

function appendScreenNote(note: ScreenSummary): void {
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
  body.append(source);
  /* The frame itself, when the meeting kept one: click it to see it properly. */
  if (note.thumbnail) {
    const shot = document.createElement("button");
    shot.className = "transcript-thumb";
    shot.type = "button";
    shot.title = "Open this capture";
    shot.setAttribute("aria-label", `Open the capture from ${stamp.textContent}`);
    const image = document.createElement("img");
    image.src = note.thumbnail;
    image.alt = "";
    shot.append(image);
    shot.addEventListener("click", () =>
      openFramePreview(note.thumbnail!, note),
    );
    body.append(shot);
  }
  body.append(text);
  row.append(stamp, body);
  const placeholder = transcriptOutput.querySelector(".transcript-empty");
  if (placeholder) placeholder.remove();
  transcriptOutput.append(row);
  applyTranscriptFilter();
  if (autoscrollEnabled) scrollTranscriptToEnd();
}

/* ============================================================
   The newest capture, in the floating bar
   ============================================================ */

/** The description the bar is showing, so the preview can label its frame. */
let latestCapture: { atMs: number; text: string } | null = null;
/** What the preview is showing, and whether it came from storage. */
let previewFrame: string | null = null;
let previewNote: { atMs: number; text: string } | null = null;
let previewStored = false;

/**
 * Shows the newest screen description in the live bar.
 *
 * The bar sits outside every view, so a capture stays visible wherever the user
 * is — on another page, with the transcript panel closed, or while the right
 * panel is showing AI activity. The full text is kept in the tooltip because the
 * bar truncates it.
 */
function showScreenCapture(note: { atMs: number; text: string }): void {
  latestCapture = note;
  if (!floatScreen || !floatScreenText) return;
  floatScreenText.textContent = note.text;
  floatScreen.title = `Show the frame the model read — ${formatDuration(Math.floor(note.atMs / 1000))}`;
  floatScreen.classList.remove("hidden");
  floatScreenSep?.classList.remove("hidden");
  floatScreen.classList.remove("is-new");
  void floatScreen.offsetWidth;
  floatScreen.classList.add("is-new");
  /* An open preview follows the newest capture rather than going stale. */
  if (!framePreview.classList.contains("hidden")) paintFramePreview();
}

function clearScreenCapture(): void {
  latestCapture = null;
  closeFramePreview();
  if (!floatScreen || !floatScreenText) return;
  floatScreenText.textContent = "";
  floatScreen.title = "";
  floatScreen.classList.add("hidden");
  floatScreen.classList.remove("is-new");
  floatScreenSep?.classList.add("hidden");
}

/** Puts a frame and its description into the open preview. */
function paintFramePreview(): void {
  if (!previewFrame || !previewNote) {
    closeFramePreview();
    return;
  }
  framePreviewImage.src = previewFrame;
  framePreviewTime.textContent = formatDuration(
    Math.floor(previewNote.atMs / 1000),
  );
  framePreviewText.textContent = previewNote.text;
  if (framePreviewNote)
    framePreviewNote.textContent = previewStored
      ? "The picture saved with this meeting — never uploaded."
      : "The frame sent to the model, held in memory for this meeting only — never saved.";
}

/**
 * Opens the preview for one capture.
 *
 * Without arguments it shows the newest frame the reader still holds; a
 * transcript row passes the thumbnail it kept, which is all that survives a
 * reload.
 */
function openFramePreview(
  frame?: string,
  note?: { atMs: number; text: string },
): void {
  const source = frame ?? screenReader?.lastFrame ?? null;
  const description = note ?? latestCapture;
  if (!source || !description) {
    showToast("That frame is no longer in memory");
    return;
  }
  previewFrame = source;
  previewNote = description;
  previewStored = Boolean(frame);
  framePreview.classList.remove("hidden");
  paintFramePreview();
}

/** Drops the decoded image as well as hiding it: memory only means memory only. */
function closeFramePreview(): void {
  if (!framePreview) return;
  previewFrame = null;
  previewNote = null;
  framePreview.classList.add("hidden");
  framePreviewImage.removeAttribute("src");
  framePreviewTime.textContent = "";
  framePreviewText.textContent = "";
}

/* ============================================================
   AI activity changelog
   ============================================================ */

/** Milliseconds since this meeting started, for every AI timestamp. */
function meetingClock(): number {
  return meetingStartedAt ? Date.now() - meetingStartedAt : 0;
}

function activityRow(
  entry: AiActivityEntry,
  index: number,
): HTMLElement {
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
  text.className = "ai-activity-text";
  text.textContent = entry.text;
  row.append(meta, text);

  /* A row the AI wrote notes on can show the content behind its line: "summary
     rewritten" is only checkable against what the model was reading when it
     decided. Screen reads, questions and errors already carry their text. */
  if (entry.sourceIndex !== undefined) {
    const expanded = openActivitySources.has(index);
    const toggle = document.createElement("button");
    toggle.className = "ai-activity-expand";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.title = "Show the transcript content this pass was given";
    toggle.innerHTML =
      '<svg class="icon" aria-hidden="true"><use href="#i-chevron"></use></svg>';
    toggle.append(expanded ? "Hide what it read" : "What it read");
    meta.append(toggle);
    row.classList.toggle("is-open", expanded);
    if (expanded) {
      const panel = document.createElement("div");
      panel.className = "ai-activity-source";
      const source = noteSources[entry.sourceIndex];
      panel.append(
        source
          ? buildNoteSource(source)
          : noteSourceEmpty(
              "The content behind this pass was not kept with the meeting.",
            ),
      );
      row.append(panel);
    }
    toggle.addEventListener("click", () => {
      if (openActivitySources.has(index)) openActivitySources.delete(index);
      else openActivitySources.add(index);
      renderActivity();
    });
  }
  return row;
}

/**
 * The AI activity log, newest first.
 *
 * The list scrolls on its own, like the transcript: a long meeting makes a long
 * log, and the notes and the numbers below it must not be pushed off the page by
 * it.
 */
function renderActivity(): void {
  aiActivityList.textContent = "";
  if (!aiActivity.length) {
    if (aiActivityEmpty) aiActivityList.append(aiActivityEmpty);
    return;
  }
  for (let index = aiActivity.length - 1; index >= 0; index -= 1)
    aiActivityList.append(activityRow(aiActivity[index], index));
}

/** Records one AI update, and keeps the meeting's stored copy in step. */
function logActivity(
  kind: AiActivityKind,
  text: string,
  sourceIndex: number | null = null,
): void {
  const trimmed = text.trim();
  const last = aiActivity[aiActivity.length - 1];
  /* A provider that is down fails on every rolling pass; one row that keeps its
     time current beats a hundred identical ones. The newest pass is also the
     relevant one to point at. */
  if (last && last.kind === kind && last.text === trimmed) {
    last.atMs = meetingClock();
    if (sourceIndex !== null) last.sourceIndex = sourceIndex;
    renderActivity();
    void persistCurrentMeeting();
    return;
  }
  const entry: AiActivityEntry = { atMs: meetingClock(), kind, text: trimmed };
  if (sourceIndex !== null) entry.sourceIndex = sourceIndex;
  aiActivity.push(entry);
  renderActivity();
  void persistCurrentMeeting();
}

function resetActivity(): void {
  aiActivity = [];
  openActivitySources.clear();
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

/** Keeps the newest answer in view: the thread floats above the ask bar. */
function scrollAskThreadToEnd(): void {
  askThreadElement.scrollTop = askThreadElement.scrollHeight;
}

/** Where the answer thread's open/closed state is remembered. */
const ASK_THREAD_KEY = "gather.ask.thread";

/** The thread is open unless the user closed it; asking opens it again. */
let askThreadOpen = (() => {
  try {
    return localStorage.getItem(ASK_THREAD_KEY) !== "0";
  } catch {
    return true;
  }
})();

function saveAskThreadOpen(open: boolean): void {
  try {
    localStorage.setItem(ASK_THREAD_KEY, open ? "1" : "0");
  } catch {
    /* the choice simply does not persist */
  }
}

/**
 * Shows or hides the answer thread.
 *
 * The panel is tall and floats over the document, so it has to be closable —
 * and, because it is the only place an answer appears, the control that hides it
 * is the same one that brings it back, with the count of what is in it.
 */
function syncAskThreadVisibility(): void {
  const turns = askThread.length;
  const open = turns > 0 && askThreadOpen;
  askThreadElement.classList.toggle("hidden", !open);
  askThreadToggle.classList.toggle("hidden", turns === 0);
  askThreadToggle.classList.toggle("is-open", open);
  askThreadToggle.setAttribute("aria-expanded", String(open));
  const label = open
    ? `Hide the ${turns} question${turns === 1 ? "" : "s"} and answers`
    : `Show the ${turns} question${turns === 1 ? "" : "s"} and answers`;
  askThreadToggle.setAttribute("aria-label", label);
  askThreadToggle.title = label;
}

askThreadToggle.addEventListener("click", () => {
  askThreadOpen = !askThreadOpen;
  saveAskThreadOpen(askThreadOpen);
  syncAskThreadVisibility();
  if (askThreadOpen) scrollAskThreadToEnd();
});

function renderAskThread(): void {
  askThreadElement.textContent = "";
  for (const turn of askThread) {
    const { row } = askTurnRow(turn);
    askThreadElement.append(row);
  }
  syncAskThreadVisibility();
  scrollAskThreadToEnd();
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
  /* Asking opens the thread: the answer is the point of the question. */
  askThreadOpen = true;
  saveAskThreadOpen(true);
  syncAskThreadVisibility();
  scrollAskThreadToEnd();
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
    scrollAskThreadToEnd();
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

floatScreen.addEventListener("click", () => {
  if (framePreview.classList.contains("hidden")) openFramePreview();
  else closeFramePreview();
});

framePreviewClose.addEventListener("click", () => closeFramePreview());

/* A click anywhere outside the bar closes the preview. */
document.addEventListener("pointerdown", (event) => {
  if (framePreview.classList.contains("hidden")) return;
  const target = event.target as Node | null;
  if (target && !floatScreen.contains(target) && !framePreview.contains(target))
    closeFramePreview();
});

/* ============================================================
   Shell behaviour
   ============================================================ */

/**
 * Shows the ask bar on the meeting page, and nowhere else.
 *
 * It is a meeting tool, like the recording bar: asking works against this
 * meeting's transcript, notes and screen captures, so the library and settings
 * have nothing to ask about. Unlike the recording bar it stays on the meeting
 * page only — "Open meeting" is one click away on every other view.
 */
function syncAskDock(): void {
  const onMeetingPage = document.body.dataset.view === "workspace";
  askDock.classList.toggle("hidden", !onMeetingPage);
  syncAskDockOffset();
}

/**
 * Sits the ask bar exactly above the recording bar.
 *
 * The recording bar wraps and grows as the screen-capture chip and the audio
 * size come and go, so its height is measured rather than assumed — a guessed
 * offset would overlap it on a narrow window or when a capture row appears.
 */
function syncAskDockOffset(): void {
  const height = liveControls.classList.contains("hidden")
    ? 0
    : liveControls.getBoundingClientRect().height;
  document.documentElement.style.setProperty(
    "--live-bar-offset",
    height ? `${Math.ceil(height) + 10}px` : "0px",
  );
}

function setView(view: ViewName): void {
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
  syncAskDock();
  /* The prepare screen owns the Start button, so make sure the model is on its
     way (or already loaded) as soon as it is opened. */
  if (view === "prepare" && initialSupport.supported)
    syncAsrProviderFromCapture();
}

function setMeetingState(state: MeetingState): void {
  document.body.dataset.meetingState = state;
  /* The bar lives outside the views: it tracks the meeting, not the page. */
  liveControls.classList.toggle("hidden", state !== "live");
  syncReturnButton();
  /* The recording bar appearing or going moves the ask bar with it. */
  syncAskDockOffset();
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
     panel and never seen. The editor is not in this panel though — #finalise
     holds only the progress strip and the error strip, so with neither showing
     it was an empty bordered box above the first section. */
  const showsStrip = state === "finalising" || state === "error";
  finalisePanel.classList.toggle("hidden", !showsStrip);
  finalisePanel.setAttribute("aria-hidden", String(!showsStrip));
  finaliseProgress.classList.toggle("hidden", state !== "finalising");
  finaliseError.classList.toggle("hidden", state !== "error");
  if (state === "listening") finaliseState.textContent = "Listening quietly";
  if (state === "finalising") finaliseState.textContent = "Finalising notes…";
  if (state === "done") finaliseState.textContent = "Notes ready to edit";
  if (state === "error") finaliseState.textContent = "Summary unavailable";
}

/**
 * Paints every section's source panel from the pass it was written by.
 *
 * Returns the index of the pass it filed, or null when the result had nothing
 * to put in any section — a pass that moved nothing is not the source of
 * anything, and must not be recorded as one.
 */
function renderNoteSections(
  result: IntelligenceResult | null,
  highlight = true,
  notesSource: NotesSource | null = null,
): number | null {
  const values: Record<keyof typeof noteFields, string> = {
    summary: result?.executiveSummary ?? "",
    keyPoints: toLines(result?.keyPoints),
    decisions: toLines(result?.decisions),
    actionItems: toLines(result?.actionItems),
    questions: toLines(result?.questions),
  };
  let passIndex: number | null = null;
  const sourceFor = (): number | null => {
    if (!notesSource) return null;
    if (passIndex === null) passIndex = recordNotesSource(notesSource);
    return passIndex;
  };
  for (const [key, value] of Object.entries(values) as Array<
    [keyof typeof noteFields, string]
  >) {
    const field = noteFields[key];
    if (!value) continue;
    field.value = value;
    const index = sourceFor();
    if (index !== null) noteSourceRef[key] = index;
    if (!highlight) continue;
    const section = field.closest<HTMLElement>(".note-section");
    if (!section) continue;
    section.classList.remove("is-updated");
    void section.offsetWidth;
    section.classList.add("is-updated");
    window.setTimeout(() => section.classList.remove("is-updated"), 1700);
  }
  renderNoteSources();
  growAllFields();
  return passIndex;
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
    noteSources: noteSources.length ? noteSources : undefined,
    noteSourceRef: Object.keys(noteSourceRef).length ? noteSourceRef : undefined,
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
  /* The cloud tabs and the vault that feeds them only make sense with local-only
     mode off; the Privacy block stays, and so does the audio-recording switch. */
  cloudSettings.classList.toggle("hidden", local);
  applySettingsTab();
  /* The engine summary says whether audio leaves the device, so it has to be
     rewritten the moment this switch moves. */
  syncAsrSettingsUi();
  syncAiStatusSummary();
  syncAskState();
}

/** Which settings tab is showing. */
function setSettingsTab(tab: "stt" | "notes"): void {
  settingsTab = tab;
  applySettingsTab();
}

/**
 * Which settings tab is showing.
 *
 * Both tabs are cloud features — a speech engine that streams audio away, and a
 * notes provider that receives text — so with local-only mode on the tab row is
 * hidden entirely rather than offering a choice that cannot be honoured. What
 * stays on this device (the audio recording) lives in the Privacy block, which
 * is always visible.
 */
function applySettingsTab(): void {
  const cloud = !privacyMode.checked;
  /* Null means "no tab at all": there is nothing cloud-side to choose between. */
  const tab = cloud ? settingsTab : null;
  asrPanel.classList.toggle("hidden", tab !== "stt");
  aiSettings.classList.toggle("hidden", tab !== "notes");
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
  /* Switching provider changes which vision model reads the screen. */
  syncScreenHint();
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
    void loadHistory();
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
