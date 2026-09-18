/**
 * TEMPORARY probe (deleted after use).
 *
 * Camera A: display audio is silent while the microphone carries speech —
 * the topology reported by the user (System audio 0.0%, Microphone 7%).
 * Camera B: the app's tab is pushed to the background, as it is when the
 * user is actually in Teams/Zoom.
 *
 *   node tmp-bg-probe.mjs <url> <wav>
 */
import { spawn } from "node:child_process";

const URL_UNDER_TEST = process.argv[2];
const WAV = process.argv[3];
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9226;
const PROFILE = `${process.env.TEMP}\\dsh-chrome-bg`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${WAV}`,
    "--window-size=1100,700",
    "--window-position=40,40",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ws;
try {
  let targets = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  const page = targets.find((t) => t.type === "page");

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Runtime.exceptionThrown")
      logs.push(
        `exception: ${String(
          message.params.exceptionDetails?.exception?.description ?? "",
        ).slice(0, 200)}`,
      );
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = (nextId += 1);
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    return response.result?.result?.value;
  };
  const sample = async (label) =>
    console.log(
      label,
      await evaluate(
        `JSON.stringify({
           elapsed: document.getElementById("duration")?.textContent,
           state: document.getElementById("transcription-state")?.textContent,
           lag: document.getElementById("transcription-lag")?.textContent,
           level: document.getElementById("transcription-level")?.textContent,
           windows: document.getElementById("transcription-windows")?.textContent,
           mixed: document.getElementById("mixed-meter-value")?.textContent,
           len: document.getElementById("transcript-output")?.textContent?.length,
           ctx: (window.__ctx && window.__ctx.state) || "unknown",
         })`,
      ),
    );

  await send("Runtime.enable");
  await send("Page.enable");

  /* Display audio exists but is silent; the microphone carries the speech. */
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const md = navigator.mediaDevices;
      const gum = md.getUserMedia.bind(md);
      md.getDisplayMedia = async () => {
        const ctx = new AudioContext();
        window.__ctx = ctx;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const dest = ctx.createMediaStreamDestination();
        gain.connect(dest);
        const osc = ctx.createOscillator();
        osc.connect(gain);
        osc.start();
        return dest.stream;
      };
    })();`,
  });

  await send("Page.navigate", { url: URL_UNDER_TEST });
  await sleep(5000);
  await evaluate(`document.querySelector('[data-view="prepare"]').click()`);

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const state = await evaluate(
      `JSON.stringify({ disabled: document.getElementById("start-button").disabled, backend: document.getElementById("backend-choice")?.textContent })`,
    );
    if (!JSON.parse(state).disabled) {
      console.log("prepare:", state);
      break;
    }
    await sleep(2000);
  }

  await evaluate(`document.getElementById("start-button").click()`);

  console.log("--- foreground, silent display track ---");
  for (let i = 0; i < 4; i += 1) {
    await sleep(5000);
    await sample(`fg+${(i + 1) * 5}s`);
  }

  console.log("--- backgrounding the app tab ---");
  const other = await send("Target.createTarget", { url: "about:blank" });
  const otherId = other.result?.targetId;
  const otherWsUrl = (
    await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  ).find((t) => t.id === otherId)?.webSocketDebuggerUrl;
  if (otherWsUrl) {
    const otherWs = new WebSocket(otherWsUrl);
    await new Promise((resolve) => otherWs.addEventListener("open", resolve, { once: true }));
    let id = 0;
    const op = new Map();
    otherWs.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && op.has(m.id)) {
        op.get(m.id)(m);
        op.delete(m.id);
      }
    });
    const osend = (method) =>
      new Promise((resolve) => {
        const n = (id += 1);
        op.set(n, resolve);
        otherWs.send(JSON.stringify({ id: n, method }));
      });
    await osend("Page.bringToFront");
    otherWs.close();
  }

  for (let i = 0; i < 6; i += 1) {
    await sleep(5000);
    await sample(`bg+${(i + 1) * 5}s`);
  }
  console.log("exceptions:", logs.join(" | ").slice(0, 400) || "none");
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  chrome.kill();
}
