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
  type TranscriptionDiagnostics,
} from "./asr/transcriptionController";
import { WhisperClient } from "./asr/whisperClient";
import type { TranscriptSegment } from "./transcript/dedup";
import { exportMarkdown } from "./backend/intelligence";
import {
  describeConfiguration,
  isConfigured,
  requestNotes,
  testConnection,
  type AiConfig,
} from "./intelligence/client";
import {
  formatActionItem,
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
  encryptionAvailable,
} from "./intelligence/vault";
import {
  deleteMeeting,
  listMeetings,
  saveMeeting,
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
const backendHint = $("backend-hint");
const deepseekState = $("deepseek-state");
const aiSettings = $("ai-settings");
const aiSettingsOffNote = $("ai-settings-off-note");
const aiReveal = $("ai-reveal") as HTMLButtonElement;
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
const aiRemember = $("ai-remember") as HTMLInputElement;
const aiVault = $("ai-vault");
const aiVaultLabel = $("ai-vault-label");
const aiVaultPass = $("ai-vault-pass") as HTMLInputElement;
const aiVaultPassToggle = $("ai-vault-pass-toggle") as HTMLButtonElement;
const aiVaultAction = $("ai-vault-action") as HTMLButtonElement;
const aiVaultStatus = $("ai-vault-status");
const aiLock = $("ai-lock") as HTMLButtonElement;
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

let capture: CaptureStreams | null = null;
let transcription: TranscriptionController | null = null;
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
    return localStorage.getItem(BACKEND_KEY) === "wasm" ? "wasm" : "auto";
  } catch {
    return "auto";
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
    onError: (message) => {
      modelError = message;
      modelState = "error";
      syncModelState();
    },
  });
  try {
    await client.load();
    whisperClient = client;
    modelState = "ready";
    syncModelState();
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
  const state =
    modelState === "loading"
      ? `loading ${Math.round(modelPercent)}%`
      : modelState === "ready"
        ? "ready"
        : modelState === "error"
          ? "not loaded"
          : "queued";
  prepareModel.textContent = `${activeModelId()} · ${state}`;
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

railToggle.addEventListener("click", () => {
  const collapsed = rail.classList.toggle("is-collapsed");
  railToggle.setAttribute("aria-expanded", String(!collapsed));
  railToggle.setAttribute(
    "aria-label",
    collapsed ? "Expand navigation" : "Collapse navigation",
  );
});

for (const tab of panelTabs) {
  tab.addEventListener("click", () => {
    setPanelTab(tab.dataset.panel === "activity" ? "activity" : "transcript");
  });
}
panelToggle.addEventListener("click", () => panel.classList.toggle("is-open"));
panelClose.addEventListener("click", () => panel.classList.remove("is-open"));

transcriptSearch.addEventListener("input", () => {
  applyTranscriptFilter();
});
transcriptAutoscroll.addEventListener("click", () => {
  autoscrollEnabled = !autoscrollEnabled;
  syncAutoscrollButton();
  if (autoscrollEnabled) scrollTranscriptToEnd();
});
transcriptList.addEventListener("scroll", () => {
  const atEnd =
    transcriptList.scrollHeight -
      transcriptList.scrollTop -
      transcriptList.clientHeight <
    24;
  if (!atEnd && autoscrollEnabled) {
    autoscrollEnabled = false;
    syncAutoscrollButton();
  }
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
  if (transcription) {
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
  if (value && rememberState() === "unlocked")
    void persistToVault(provider, value);
  setAiStatus(value ? "Key ready for this session." : "");
  syncAiStatusSummary();
});

aiRemember.addEventListener("change", () => {
  aiVault.classList.toggle("hidden", !aiRemember.checked);
  if (!aiRemember.checked) {
    setVaultStatus("");
    if (rememberState() === "unlocked") {
      void forgetRememberedKey(loadAiSettings().provider).then(
        ({ erasedVault }) => {
          setVaultStatus(
            erasedVault ? "Vault erased." : "Key no longer remembered.",
            "ok",
          );
          syncAiStatusSummary();
        },
      );
    }
    return;
  }
  refreshVaultPanel();
  aiVaultPass.focus();
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
  const provider = loadAiSettings().provider;
  lockRememberedKeys();
  /* Locking means "stop using the key", not just "hide the stored copy". */
  clearSessionKey(provider);
  syncAiSettingsUi();
  setVaultStatus(
    "Vault locked and the key cleared from this session. Unlock to use it again.",
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
aiReveal.addEventListener("click", () => {
  privacyMode.checked = false;
  syncPrivacyState();
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
setView("library");
setMeetingState("idle");
syncAutoscrollButton();
/* Load Whisper now rather than after the user has picked a screen: by the
   time a meeting starts the model is normally already in memory. */
if (initialSupport.supported) {
  const preload = () => void ensureWhisperModel();
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
    renderTranscript(
      undefined,
      [],
      modelState === "ready"
        ? "Listening for the first words…"
        : "Loading the English Whisper model locally…",
    );
    liveLabel.textContent = "Recording";
    modelStatus.textContent = modelInput.value;
    transcriptionLevel.textContent = "—";
    transcriptionWindows.textContent = "—";
    transcriptionStatus.textContent = "";
    silentWarned = false;
    wordsWarned = false;
    noWindowsWarned = false;
    throttledWarned = false;
    lastDiagnosticsAt = 0;
    lastSnapshot = null;
    lastRollingAt = 0;
    rollingInFlight = false;
    syncAiStatusSummary();
    /* Capture first so the display prompt keeps its user gesture, then make
       sure the model is ready. It normally already is. */
    const client = await ensureWhisperModel();
    if (!client) {
      throw new Error(
        modelError ||
          "The Whisper model could not be loaded. Use “Reload model” and try again.",
      );
    }
    transcription = new TranscriptionController(
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
      {
        onState: (value) => {
          stateElement.textContent = value;
          const loading = /loading|download/i.test(value);
          notesSkeleton.classList.toggle("hidden", !loading);
          if (!loading && latestSegments.length === 0)
            stateElement.textContent = value;
        },
        onSegment: (segment, all) => {
          latestSegments = all;
          notesSkeleton.classList.add("hidden");
          renderTranscript(segment, all);
          void updateIntelligence();
          void persistCurrentMeeting();
        },
        onLag: (lag) => {
          transcriptionLag.textContent = `${Math.round(lag)} ms`;
        },
        onDiagnostics: handleTranscriptionDiagnostics,
        onError: showError,
      },
      client,
    );
    await transcription.start(capture);
    notesSkeleton.classList.add("hidden");
    startButton.classList.add("hidden");
    startIconButton.classList.add("hidden");
    pauseButton.classList.remove("hidden");
    pauseIconButton.classList.remove("hidden");
    stopButton.classList.remove("hidden");
    stopIconButton.classList.remove("hidden");
    livePill.className = "live-pill is-live";
    livePill.textContent = privacyMode.checked
      ? "Transcribing locally"
      : "Transcribing locally · AI ready";
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

function handlePauseResume(): void {
  if (!transcription) return;
  if (pauseButton.textContent === "Pause") {
    transcription.pause();
    pauseButton.textContent = "Resume";
    livePill.textContent = "Paused";
    liveLabel.textContent = "Paused";
    liveControls.classList.add("is-paused");
  } else {
    transcription.resume();
    pauseButton.textContent = "Pause";
    livePill.textContent = "Transcribing locally";
    liveLabel.textContent = "Recording";
    liveControls.classList.remove("is-paused");
  }
}

async function handleStop(message?: string): Promise<void> {
  const currentTranscription = transcription;
  transcription = null;
  if (currentTranscription) await currentTranscription.stop();
  const currentCapture = capture;
  capture = null;
  await stopCapture(currentCapture);
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
      transcript: transcriptText(),
      sessionId,
      final: true,
    });
    notesSkeleton.classList.add("hidden");
    applyNotes(result);
    await persistCurrentMeeting();
    setFinaliseState("done");
    showToast("Final notes are ready");
  } catch (error) {
    notesSkeleton.classList.add("hidden");
    setFinaliseState("error");
    finaliseErrorText.textContent = `${
      error instanceof Error
        ? error.message
        : "The AI provider could not generate notes."
    } Your transcript is safe and saved locally.`;
    finaliseError.classList.remove("hidden");
    stateElement.textContent = "Transcript saved · AI notes unavailable";
    deepseekState.textContent = "Error";
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
    });
    applyNotes(result);
    deepseekState.textContent = "Connected";
  } catch (error) {
    aiOutput.textContent =
      error instanceof Error
        ? error.message
        : "AI notes are unavailable; local transcription continues.";
    stateElement.textContent = "Local transcription active · AI unavailable";
    deepseekState.textContent = "Error";
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
  const parts = [`input ${level}`];
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

function transcriptText(): string {  return latestSegments
    .slice(-100)
    .map((segment) => segment.text)
    .join(" ");
}

/** Single place that syncs a fresh result into notes, state and persistence. */
function applyNotes(result: IntelligenceResult): void {
  latestGeneratedNotes = { ...result };
  latestSummary = { ...result };
  renderNoteSections(result);
  aiOutput.textContent = formatIntelligence(latestSummary);
  finaliseState.textContent = "Notes just updated";
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
  renderTranscript(latestSegments[latestSegments.length - 1], latestSegments);
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
}

/**
 * Keeps the transcript panel honest when the transcriber reports nothing at
 * all. Windows are only decided every few seconds, so this heartbeat must not
 * confuse "a slow inference is running" with "no audio ever arrived" — the
 * warning is only for the case where no window has *ever* been produced.
 */
function syncTranscriptionStatus(mixedLevel: number): void {
  if (startedAt === null) return;
  if (Date.now() - lastDiagnosticsAt < 3000) return;
  const level = formatLevelPercent(mixedLevel);
  if (lastSnapshot) {
    const working =
      lastSnapshot.inFlightMs > 0
        ? lastSnapshot.inFlightMs + (Date.now() - lastDiagnosticsAt)
        : 0;
    transcriptionStatus.textContent =
      working > 0
        ? `input ${level} · ${lastSnapshot.transcribed} windows · working ${(working / 1000).toFixed(1)}s`
        : `input ${level} · ${lastSnapshot.transcribed} windows · last result ${(lastSnapshot.sinceInferenceMs / 1000).toFixed(0)}s ago`;
    return;
  }
  transcriptionStatus.textContent = `input ${level} · no windows yet`;
  if (Date.now() - startedAt < 12_000 || noWindowsWarned) return;
  noWindowsWarned = true;
  showError(
    `The microphone is registering audio (${level}) but no audio is reaching the transcriber. Reload the page and start a new meeting; if it repeats the capture path needs fixing.`,
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
function renderTranscript(
  latest: TranscriptSegment | undefined,
  all: TranscriptSegment[],
  emptyMessage = "Your conversation will appear here once capture starts.",
): void {
  transcriptOutput.textContent = "";
  if (!all.length) {
    const empty = document.createElement("p");
    empty.className = "transcript-empty";
    empty.textContent = emptyMessage;
    transcriptOutput.append(empty);
    return;
  }
  let seconds = 0;
  for (const segment of all) {
    seconds = Math.floor(segment.startMs / 1000);
    const row = document.createElement("div");
    row.className = "transcript-segment";

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
    transcriptOutput.append(row);
  }
  applyTranscriptFilter();
  if (latest && autoscrollEnabled) scrollTranscriptToEnd();
}

/* ============================================================
   Shell behaviour
   ============================================================ */

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
  /* The prepare screen owns the Start button, so make sure the model is on its
     way (or already loaded) as soon as it is opened. */
  if (view === "prepare" && initialSupport.supported) void ensureWhisperModel();
}

function setMeetingState(state: MeetingState): void {
  document.body.dataset.meetingState = state;
  liveControls.classList.toggle("hidden", state !== "live");
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

function scrollTranscriptToEnd(): void {
  transcriptList.scrollTop = transcriptList.scrollHeight;
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
  /* The AI notes service is only configurable when it can actually be used. */
  aiSettings.classList.toggle("hidden", local);
  aiSettingsOffNote.classList.toggle("hidden", !local);
  syncAiStatusSummary();
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
 * Reflect stored state into the checkbox. Only ever called when the view is
 * (re)rendered — never from a change handler, so it cannot fight the user.
 */
function syncRememberCheckbox(): void {
  const provider = loadAiSettings().provider;
  const state = rememberState();
  if (state === "locked")
    aiRemember.checked = true; // contents are unknowable until unlocked
  else if (state === "unlocked")
    aiRemember.checked = hasRememberedKey(provider);
}

async function persistToVault(
  provider: ProviderId,
  value: string,
): Promise<void> {
  try {
    await rememberApiKey(provider, value, "");
    setVaultStatus("Remembered key updated.", "ok");
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
  const provider = loadAiSettings().provider;
  const passphrase = aiVaultPass.value;
  const state = rememberState();
  if (state === "none" && !aiKey.value.trim()) {
    setVaultStatus("Enter the key first, then remember it.", "error");
    return;
  }
  aiVaultAction.disabled = true;
  setVaultStatus(state === "locked" ? "Unlocking…" : "Encrypting…");
  try {
    if (state === "none") {
      await rememberApiKey(provider, aiKey.value, passphrase);
      setVaultStatus("Key encrypted and remembered on this device.", "ok");
    } else if (state === "locked") {
      await unlockRememberedKeys(passphrase);
      setVaultStatus("Vault unlocked for this session.", "ok");
    } else {
      await persistToVault(provider, aiKey.value);
    }
    aiVaultPass.value = "";
    aiKey.value = getApiKey(provider);
    syncRememberCheckbox();
    refreshVaultPanel();
    syncAiSettingsUi();
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
