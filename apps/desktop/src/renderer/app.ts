import { $, setStatus } from "./ui/components";
import { patch, state, subscribe, generateSessionId } from "./ui/state";
import { listAudioInputs, getStream } from "./audio/capture";
import { OUT_SR, mixToMono, resampleLinear, f32ToPCM16 } from "./audio/resampler";
import { createWS } from "./net/ws";
import { postTranscribe } from "./net/api";

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"));
const panels = Array.from(document.querySelectorAll<HTMLElement>(".tab-panel"));

const languageSel = $("#language") as HTMLSelectElement;
const actionBtn = $("#action") as HTMLButtonElement;
const statusEl = $("#status") as HTMLDivElement;
const output = $("#out") as HTMLTextAreaElement;

const advMode = $("#mode") as HTMLSelectElement;
const srInput = $("#sr") as HTMLInputElement;
const frameInput = $("#frame") as HTMLInputElement;

const fileInput = $("#fileInput") as HTMLInputElement;
const fileName = $("#fileName") as HTMLSpanElement;
const pickFile = $("#pickFile") as HTMLButtonElement;
const audioPreview = $("#audioPreview") as HTMLAudioElement;
const summaryToggle = $("#summaryToggle") as HTMLInputElement;

const deviceSel = $("#device") as HTMLSelectElement;
const refreshDevices = $("#refreshDevices") as HTMLButtonElement;

const sessionInput = $("#sessionId") as HTMLInputElement;
const regenSession = $("#regenSession") as HTMLButtonElement;

const copyBtn = $("#copy") as HTMLButtonElement;
const clearBtn = $("#clear") as HTMLButtonElement;
const themeBtn = $("#theme") as HTMLButtonElement;
const saveSummaryBtn = $("#saveSummary") as HTMLButtonElement;

const summaryCard = $("#summaryCard") as HTMLElement;
const summaryTitle = $("#summaryTitle") as HTMLElement;
const summaryExec = $("#summaryExec") as HTMLElement;
const summaryKeyPoints = $("#summaryKeyPoints") as HTMLUListElement;
const summaryActions = $("#summaryActions") as HTMLUListElement;
const summaryLang = $("#summaryLang") as HTMLElement;

let ctx: AudioContext | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let proc: ScriptProcessorNode | null = null;
const ws = createWS();

let acc = new Float32Array(0);
let lastSummaryData: Record<string, unknown> | null = null;
let lastSummaryLang: string | null = null;
function chunkAndSend(mono16k: Float32Array) {
  const frameMs = Number(frameInput.value);
  const frameSamples = Math.round((OUT_SR * frameMs) / 1000);
  const merged = new Float32Array(acc.length + mono16k.length);
  merged.set(acc, 0);
  merged.set(mono16k, acc.length);
  let off = 0;
  while (off + frameSamples <= merged.length) {
    const slice = merged.subarray(off, off + frameSamples);
    const buf = f32ToPCM16(slice);
    ws.sendBinary(buf);
    patch({ frames: state.frames + 1, bytes: state.bytes + buf.byteLength });
    off += frameSamples;
  }
  acc = merged.subarray(off);
  patch({ pendingSamples: acc.length });
}

async function populateDevices() {
  const devs = await listAudioInputs();
  deviceSel.innerHTML = "";
  devs.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Device ${i + 1}`;
    deviceSel.appendChild(opt);
  });
  if (!devs.length) {
    setStatus(statusEl, "No audio devices found. Install a loopback driver if needed.");
  }
}

function setTab(tab: "files" | "record") {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== tab));
  patch({ mode: tab as any });
  advMode.value = tab;
  actionBtn.textContent = tab === "files" ? "Transcribe" : state.running ? "Stop" : "Record & Transcribe";
}

tabs.forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab as any)));

languageSel.addEventListener("change", () => patch({ language: languageSel.value }));

sessionInput.addEventListener("change", () => {
  const value = sessionInput.value.trim() || generateSessionId();
  sessionInput.value = value;
  patch({ sessionId: value });
});

regenSession.addEventListener("click", () => {
  const id = generateSessionId();
  sessionInput.value = id;
  patch({ sessionId: id });
});

summaryToggle.addEventListener("change", () => {
  patch({ summaryEnabled: summaryToggle.checked });
});

refreshDevices.addEventListener("click", () => populateDevices().catch(() => {}));

pickFile.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (!f) {
    fileName.textContent = "No file chosen";
    audioPreview.src = "";
    return;
  }
  fileName.textContent = f.name;
  audioPreview.src = URL.createObjectURL(f);
});

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(output.value);
  setStatus(statusEl, "Copied transcript to clipboard.");
});

clearBtn.addEventListener("click", () => {
  output.value = "";
  setStatus(statusEl, "Transcript cleared.");
});

themeBtn.addEventListener("click", () => {
  document.body.classList.toggle("light");
});

advMode.addEventListener("change", () => setTab(advMode.value as any));

function resetSummary() {
  summaryCard.classList.add("hidden");
  summaryTitle.textContent = "Summary";
  summaryExec.textContent = "";
  summaryKeyPoints.innerHTML = "";
  summaryActions.innerHTML = "";
  summaryLang.textContent = "";
  saveSummaryBtn.disabled = true;
  lastSummaryData = null;
  lastSummaryLang = null;
}

function updateSummary(summary: any, detectedLang: string | undefined) {
  if (!summary || Object.keys(summary).length === 0) {
    resetSummary();
    return;
  }

  summaryCard.classList.remove("hidden");

  summaryTitle.textContent = summary.title || "Summary";
  summaryExec.textContent = summary.executiveSummary || summary.notes || "";

  const keyPointsSource = Array.isArray(summary.keyPoints)
    ? summary.keyPoints
    : Array.isArray(summary.key_points)
    ? summary.key_points
    : [];

  summaryKeyPoints.innerHTML = "";
  if (keyPointsSource.length) {
    for (const point of keyPointsSource) {
      const li = document.createElement("li");
      li.textContent = typeof point === "string" ? point : JSON.stringify(point);
      summaryKeyPoints.appendChild(li);
    }
  } else {
    const li = document.createElement("li");
    li.textContent = "No key points provided.";
    summaryKeyPoints.appendChild(li);
  }

  const actionsSource = Array.isArray(summary.actionItems)
    ? summary.actionItems
    : Array.isArray(summary.action_items)
    ? summary.action_items
    : Array.isArray(summary.actions)
    ? summary.actions
    : [];

  summaryActions.innerHTML = "";
  if (actionsSource.length) {
    for (const action of actionsSource) {
      const li = document.createElement("li");
      if (typeof action === "string") {
        li.textContent = action;
      } else {
        const owner = action.owner ? `${action.owner}: ` : "";
        const desc = action.description || action.text || JSON.stringify(action);
        const dueRaw = action.dueDate || action.due_date || "";
        const due = typeof dueRaw === "string" ? dueRaw.trim() : dueRaw;
        li.textContent = due ? `${owner}${desc} (due ${due})` : `${owner}${desc}`;
      }
      summaryActions.appendChild(li);
    }
  } else {
    const li = document.createElement("li");
    li.textContent = "No action items.";
    summaryActions.appendChild(li);
  }

  const langLabel = detectedLang || summary.language;
  summaryLang.textContent = langLabel ? `Detected language: ${langLabel}` : "";

  saveSummaryBtn.disabled = false;
  lastSummaryData = summary;
  lastSummaryLang = langLabel || null;
}

function formatSummaryForOutput(summary: any, langLabel?: string | null): string {
  const lines: string[] = [];
  const title = summary.title || "Summary";
  lines.push(`Title: ${title}`);

  const exec = summary.executiveSummary || summary.notes || "";
  if (exec) {
    lines.push("", "Executive Summary:");
    lines.push(exec);
  }

  const keyPointsSource = Array.isArray(summary.keyPoints)
    ? summary.keyPoints
    : Array.isArray(summary.key_points)
    ? summary.key_points
    : [];
  if (keyPointsSource.length) {
    lines.push("", "Key Points:");
    for (const point of keyPointsSource) {
      lines.push(`- ${typeof point === "string" ? point : JSON.stringify(point)}`);
    }
  } else {
    lines.push("", "Key Points: none.");
  }

  const actionsSource = Array.isArray(summary.actionItems)
    ? summary.actionItems
    : Array.isArray(summary.action_items)
    ? summary.action_items
    : Array.isArray(summary.actions)
    ? summary.actions
    : [];
  if (actionsSource.length) {
    lines.push("", "Action Items:");
    for (const action of actionsSource) {
      if (typeof action === "string") {
        lines.push(`- ${action}`);
      } else {
        const owner = action.owner ? `${action.owner}: ` : "";
        const desc = action.description || action.text || JSON.stringify(action);
        const dueRaw = action.dueDate || action.due_date || "";
        const due = typeof dueRaw === "string" ? dueRaw.trim() : dueRaw;
        const suffix = due ? ` (due ${due})` : "";
        lines.push(`- ${owner}${desc}${suffix}`);
      }
    }
  } else {
    lines.push("", "Action Items: none.");
  }

  if (langLabel) {
    lines.push("", `Detected language: ${langLabel}`);
  }

  return lines.join("\n");
}

function appendTranscriptLine(text: string) {
  if (!text) return;
  output.value += `${text}\n`;
  output.scrollTop = output.scrollHeight;
}

function toSafeFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "summary";
}

saveSummaryBtn.addEventListener("click", () => {
  if (!lastSummaryData) {
    setStatus(statusEl, "No summary to save.");
    return;
  }
  const text = formatSummaryForOutput(lastSummaryData, lastSummaryLang);
  if (!text.trim()) {
    setStatus(statusEl, "Nothing to save.");
    return;
  }
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const title = typeof lastSummaryData.title === "string" ? lastSummaryData.title : "summary";
  anchor.href = url;
  anchor.download = `${toSafeFilename(title)}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  setStatus(statusEl, "Summary saved.");
});

ws.onMessage = (msg) => {
  try {
    const obj = JSON.parse(msg);
    switch (obj.type) {
      case "asr.partial":
        setStatus(statusEl, obj.text ? `Partial: ${obj.text}` : "Receiving audio...");
        break;
      case "asr.final":
        appendTranscriptLine(obj.text || "");
        break;
      case "summary.final":
        updateSummary(obj, obj.language || state.language);
        break;
      default:
        appendTranscriptLine(msg);
    }
  } catch {
    appendTranscriptLine(msg);
  }
};

async function startRecord() {
  const hello = {
    type: "client.hello",
    codec: "pcm16",
    sample_rate: OUT_SR,
    channels: 1,
    frame_ms: Number(frameInput.value),
    language_hint: languageSel.value === "auto" ? undefined : languageSel.value,
    user_agent: "transcriber-desktop/0.1",
  };
  await ws.open(hello, {
    baseUrl: state.baseUrl,
    sessionId: state.sessionId,
    language: state.language,
  });

  const stream = await getStream(deviceSel.value || undefined);
  ctx = new AudioContext();
  patch({ inSR: ctx.sampleRate });
  source = ctx.createMediaStreamSource(stream);
  proc = ctx.createScriptProcessor(2048, source.channelCount, 1);
  proc.onaudioprocess = (e) => {
    if (!state.running) return;
    const mono = mixToMono(e.inputBuffer);
    const mono16k = resampleLinear(mono, ctx!.sampleRate);
    chunkAndSend(mono16k);
  };
  source.connect(proc);
  proc.connect(ctx.destination);
  patch({ running: true, frames: 0, bytes: 0, outSR: OUT_SR, frameMs: Number(frameInput.value) });
  setStatus(statusEl, "Recording...");
  actionBtn.textContent = "Stop";
  output.value = "";
  resetSummary();
}

async function stopRecord() {
  patch({ running: false });
  try {
    proc?.disconnect();
    source?.disconnect();
  } catch {}
  try {
    await ctx?.close();
  } catch {}
  acc = new Float32Array(0);
  ws.close();
  setStatus(statusEl, "Stopped");
  actionBtn.textContent = "Record & Transcribe";
}

async function transcribeFileInput() {
  const f = fileInput.files?.[0];
  if (!f) {
    setStatus(statusEl, "Please choose an audio file first.");
    return;
  }
  output.value = "";
  resetSummary();
  setStatus(statusEl, "Uploading audio...");
  try {
    const data = await postTranscribe(state.baseUrl, f, state.language, state.summaryEnabled);
    output.value = data.transcript || "";
    updateSummary(data.summary, data.detected_language);
    setStatus(statusEl, "Done");
  } catch (err: any) {
    resetSummary();
    setStatus(statusEl, `Error: ${err?.message || err}`);
  }
}

actionBtn.addEventListener("click", async () => {
  actionBtn.disabled = true;
  try {
    if (state.mode === "record") {
      if (!state.running) {
        if (!sessionInput.value.trim()) {
          sessionInput.value = generateSessionId();
          patch({ sessionId: sessionInput.value });
        }
        await startRecord();
      } else {
        await stopRecord();
      }
    } else {
      await transcribeFileInput();
    }
  } catch (e: any) {
    setStatus(statusEl, `Error: ${e?.message || e}`);
  } finally {
    actionBtn.disabled = false;
  }
});

window.addEventListener("DOMContentLoaded", () => {
  sessionInput.value = state.sessionId;
  summaryToggle.checked = state.summaryEnabled;
  languageSel.value = state.language;
  populateDevices().catch(() => {});
  setTab("files");
  resetSummary();
});

subscribe((s) => {
  if (document.activeElement !== sessionInput) sessionInput.value = s.sessionId;
  summaryToggle.checked = s.summaryEnabled;
  languageSel.value = s.language;
});
