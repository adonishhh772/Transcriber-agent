/**
 * TEMPORARY headed-GPU probe (deleted after use): runs the real app in a
 * visible Chrome window on the real GPU and samples the diagnostics.
 *
 *   node tmp-gpu-probe.mjs <url> <wav> [seconds]
 */
import { spawn } from "node:child_process";

const URL_UNDER_TEST = process.argv[2];
const WAV = process.argv[3];
const SECONDS = Number(process.argv[4] ?? 40);
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9225;
const PROFILE = `${process.env.TEMP}\\dsh-chrome-gpu`;

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
  const page = targets?.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");

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
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(" ");
      logs.push(`${message.params.type}: ${text}`.slice(0, 220));
    }
    if (message.method === "Runtime.exceptionThrown")
      logs.push(
        `exception: ${String(
          message.params.exceptionDetails?.exception?.description ?? "",
        ).slice(0, 220)}`,
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

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const md = navigator.mediaDevices;
      const gum = md.getUserMedia.bind(md);
      md.getDisplayMedia = async () => gum({ audio: true });
    })();`,
  });

  await send("Page.navigate", { url: URL_UNDER_TEST });
  await sleep(5000);
  await evaluate(`document.querySelector('[data-view="prepare"]').click()`);

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const state = await evaluate(
      `JSON.stringify({
         disabled: document.getElementById("start-button").disabled,
         backend: document.getElementById("backend-choice")?.textContent,
         model: document.getElementById("prepare-model")?.textContent,
       })`,
    );
    if (!JSON.parse(state).disabled) {
      console.log("prepare:", state);
      break;
    }
    await sleep(2000);
  }

  await evaluate(`document.getElementById("start-button").click()`);

  const deadlineEnd = Date.now() + SECONDS * 1000;
  while (Date.now() < deadlineEnd) {
    await sleep(5000);
    console.log(
      "t+" + Math.round((Date.now() - (deadlineEnd - SECONDS * 1000)) / 1000) + "s " +
        (await evaluate(
          `JSON.stringify({
             elapsed: document.getElementById("duration")?.textContent,
             state: document.getElementById("transcription-state")?.textContent,
             lag: document.getElementById("transcription-lag")?.textContent,
             level: document.getElementById("transcription-level")?.textContent,
             windows: document.getElementById("transcription-windows")?.textContent,
             backend: document.getElementById("backend-choice")?.textContent,
             len: document.getElementById("transcript-output")?.textContent?.length,
             alert: document.getElementById("error-text")?.textContent,
           })`,
        )),
    );
  }
  console.log(
    "TRANSCRIPT " +
      (await evaluate(
        `document.getElementById("transcript-output")?.textContent?.slice(0, 300)`,
      )),
  );
  console.log("LOGS:\n" + logs.slice(-20).join("\n"));
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  chrome.kill();
}
