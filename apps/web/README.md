# Browser-local meeting transcription prototype

Stages 1–2 are local-only Windows Chrome/Edge prototypes. The app asks the user to choose a display and microphone, mixes the two audio paths in the Web Audio API, and runs configurable English Whisper transcription in a dedicated browser worker. It does **not** send audio or screen video to the backend, and it does not implement DeepSeek.

## Stage 2 local Whisper

The default configurable model identifier is `Xenova/whisper-tiny.en`. The worker currently isolates model loading, backend selection, progress reporting, chunk scheduling, and cleanup. The model-runtime adapter is the boundary for wiring the chosen browser Whisper package and quantized model artifacts; no inference request leaves the browser.

The model is loaded **before** a meeting rather than while one starts: the app warms it up as soon as it is idle (and again when the preparation screen opens), keeps the worker alive between meetings, and leaves "Start meeting" disabled until the model reports ready. Failures are explicit — a worker that cannot start, a download that reports no progress for two minutes, or a rejected model id all surface a message with a "Reload model" action instead of leaving the app on "Loading…". Changing the model id in Settings reloads it when the user stops typing.

Capture is deliberately forgiving and never silently idle. Windows quieter than 0.0015 RMS are skipped to save inference work, and that decision is reported rather than hidden: the transcript panel carries a live line (`input 7% · 5 windows · last result 3s ago`), the AI-activity panel shows the input level and a `transcribed · too quiet` count, meters print a decimal below 1% so a quiet input does not read as a dead `0%`, and each stall mode has its own message — no audio at all (capture), audio that never reaches the transcriber (capture graph), an inference stuck for 30 seconds (Chrome throttles hidden tabs, which a meeting app in front will cause), and audio that produces no words (model or GPU). Compute is selectable in Settings: `Auto` uses WebGPU when an adapter is available, `CPU only` forces the WASM path when a GPU driver misbehaves, and reloading the model mid-meeting swaps the fresh client into the running controller.

Recommended company-laptop starting point:

- `Xenova/whisper-tiny.en`: approximately 75–150 MB downloaded depending on quantization/runtime files; typically several hundred MB of working memory.
- A quantized base English model can improve accuracy but may require roughly 2–4x the download and memory budget.
- Actual memory, load time, and real-time factor depend heavily on CPU, GPU, browser version, and model files.

The UI defaults to 6-second windows with 2 seconds of overlap, suppresses low-RMS windows, and deduplicates repeated boundary words. Window and overlap values are configurable before capture. Cadence adapts at runtime (`src/asr/chunkScheduler.ts`): the first window after speech starts is short so words appear after a couple of seconds, the stride then tracks the measured inference time — a slow CPU fallback widens it (fewer, longer strides) while a GPU narrows it for near-continuous updates — and stale audio is dropped only when the device still cannot keep up, so the transcript never drifts minutes behind.

## Meeting audio, and leaving the page

`Settings → Privacy → Save the meeting audio` (on by default) records the
same mixed stream the transcriber hears and keeps it with the meeting, so a
transcript can be replayed against its audio. The recording is stored in the
browser in its own IndexedDB store (meeting audio is never loaded into the
library list, and never uploaded), appears as a player plus **Download audio**
in the meeting view, and is deleted with the meeting. It sits in the Privacy
block because it is a this-device setting, and it stays reachable when
local-only mode hides the cloud tabs.

## What screen reading can and cannot see

The app never takes screenshots of its own accord. It reads **one** surface: the
one picked in the browser's share dialog when the meeting starts, delivered as
the display track that also carries the meeting audio.

- `surfaceSwitching: "exclude"` removes the picker's switch control, so the
  surface chosen at the start is the only one that meeting can read. (These
  display options have to sit at the top level of the options dictionary — nested
  inside the audio constraints the browser ignores them, which is why this is
  spelled out here and covered by a test.)
- `selfBrowserSurface: "exclude"` keeps this app's own tab out of the picker, so
  a share can never loop back into this page.
- The picker hint prefers **Window**, so the default is one window rather than
  the whole desktop. Sharing a tab or an entire screen is still allowed: a web
  meeting often lives in a tab, and Windows offers system audio most reliably for
  a monitor.
- Nothing else on the machine is captured, and there is no periodic desktop
  screenshot: one frame every ~25 seconds, only when the picture changed,
  downscaled to 640px and reduced to a text description. Two screen *images*
  exist, and both are deliberately narrow:
  - the frame the model just read, **in memory only**, shown when you click the
    capture chip and dropped the moment the meeting ends;
  - a small thumbnail (~3 KB, 320px wide) kept with each capture so the
    transcript shows what was on screen and still shows it when you reopen the
    meeting a week later. *Keep the frame with each capture* in Settings turns
    that off; it is deleted with the meeting and never uploaded.
- After the picker closes, the app says which surface it got: *"Screen reading is
  limited to the shared window"*, or, if the whole monitor was shared, a warning
  that everything on it — other windows included — is visible to the model.

## Which model reads the screen

Screen reading uses a **separate vision model per provider**, never the notes
model — that is what makes it work with any notes model, including text-only ones
like `deepseek-chat` and `deepseek-reasoner`. The settings hint names the one in
use, and the notes model is only mentioned when it differs:

| AI provider | Vision model | Wire |
| --- | --- | --- |
| DeepSeek | `deepseek-flash` | `image_url` block |
| OpenAI | `gpt-4o-mini` | `image_url` block |
| Claude (Anthropic) | `claude-haiku-4-5` | Anthropic `image` block |
| Google Gemini | `gemini-2.5-flash` | `inline_data` part |
| OpenRouter | `openai/gpt-4o-mini` | `image_url` block |
| Custom server | — | screens are skipped, with the reason shown in Settings |

Local-only mode refuses to read screens at all, because a screen description can
only come from a cloud vision model.

If you need a hard guarantee that only the meeting is read, pick that one window;
the app cannot restrict the picker further, because the browser deliberately
leaves the choice to the user.

A running meeting is no longer tied to its page: the live bar (elapsed time,
input levels, audio size, **the newest shared-screen capture**, Pause, End
meeting and **Open meeting**) sits outside every view, so recording and
transcription continue while you browse the library or settings, and one click
returns to the meeting. Ending a meeting from another page brings that view back
rather than opening a dialog you cannot see.

The capture chip matters because a screen description is otherwise only a row
inside the right-hand panel: the bar is outside the views and fixed to the
viewport, so the newest description — with its `mm:ss` and the full text in the
tooltip — stays visible with the panel closed, while AI activity is showing, or
scrolled to the bottom of a long transcript. It clears when the meeting ends.

Clicking the chip opens the frame the model actually read, and a thumbnail in a
`Shared screen` transcript row opens the picture saved with that capture. The
chip holds the sent frame **in memory only** for the meeting: it is never written
to IndexedDB or localStorage, the preview drops the decoded image when it closes,
and the reader discards it the moment it stops. The thumbnails in the transcript
are the stored ones, and they come back with the meeting. Escape closes the
preview first; pressed again it opens the end-meeting dialog, exactly like the
**End meeting** button.

## The meeting ends when you say so

Nothing the browser does ends a recording. A window share disappears in ordinary
use — Chrome stops capturing a window that is closed, pauses one that is
minimised, and the browser's own *Stop sharing* bar ends the track — and every
one of those used to end the meeting outright and throw the rest of the
conversation away.

- Losing the surface now **pauses system audio and screen reading only**. The
  microphone, the recorder and the transcriber stay on the same capture graph, so
  the transcript carries on with the room in front of you.
- A warning appears in the document and on the live bar, naming what happened,
  and stays until the surface comes back.
- **Share again** (in that warning, and on the live bar) re-opens the picker and
  rewires the new surface into the running meeting: the new display source feeds
  the same analyser and mixer, and the mixed destination the recorder and the
  transcriber hold is untouched, so there is no seam in the transcript. Screen
  reading restarts on the new surface and keeps everything already read; its
  timestamps stay meeting-relative rather than restarting at 00:00.
- If the new share carries no system audio, the app says so and keeps the surface
  it had.
- `Escape` no longer stops capture on its own: it opens the end-meeting dialog,
  so a stray keypress can only ever ask.
- A running meeting also holds a **Web Lock** for as long as it lasts. Chromium
  will not freeze a hidden page that is holding one, and freezing stops every
  timer and callback in the page — the meters, the recorder and the transcriber
  with them. A meeting watched in another window is exactly a hidden tab, and a
  quiet stretch is exactly when nobody is looking at this one, so the hold is one
  of the two ways this page stays awake (capturing a screen is the other, and it
  is gone once the share is lost). The hold is released the moment the meeting
  ends.

## Reading notes as a page, and as a claim

The workspace document flows: the notes are the page, not a pane inside it. The
only two scroll regions in the workspace are the transcript panel and the **AI
activity** log, each with its own small scroll.

Every note section title is also the control that opens **what that section was
written from**: the transcript lines and screen captures that were sent for the
pass that wrote it, timestamped, with the pass (rolling or end-of-meeting), the
provider · model that answered and the speech engine that produced the lines. The
content can be copied on its own, and opening it lengthens the document like any
other disclosure. A section that a later pass did not touch keeps the source of
the pass that did.

The **AI activity** tab answers the same question for every line in the log: a
`Notes updated` or `Final notes` row carries a **What it read** control that opens
the same panel for that pass, so "summary rewritten · 15 new key points" can be
checked against the transcript lines the model was reading when it decided. The
log itself scrolls in its own small region — a long meeting makes a long log, and
the latest notes and the counters below it must not be pushed off the page by it.
Rows for screen reads, questions and errors are not expandable: their text *is*
their content.

A pass is recorded as a **range of transcript lines**, not a copy of them. The
transcript is append-only (`mergeOverlappingTranscript` never moves or rewrites a
stored line, which a test pins), so a range stays exact for the life of the
meeting and costs two numbers — which is why every pass of a meeting can be kept
rather than a trimmed recent few. Only the screen captures travel with the pass.
All of it is stored with the meeting, so the content behind a summary is still
readable after a reload, a restart or a month in the library.

Passes are recorded before the request is sent — the record says what the model
was actually given, not what happened to be around when the answer came back.

## Ask about this meeting

Asking is a **floating bar on the meeting page**, built like the recording bar
and living outside the views, so a question is always in reach: at the foot of a
long document is exactly where it used to be out of reach. It shows on the
meeting page only — asking works against this meeting's transcript, notes and
screen captures, so the library and settings have nothing to ask about, and
**Open meeting** is one click away everywhere else.

- While a meeting is recording, the ask bar rides **above** the recording bar.
  The recording bar wraps and grows as its content changes (a screen capture
  appears, the audio size shows up), so its height is **measured** with a
  `ResizeObserver` and fed to the ask bar as a CSS offset — a guessed number
  would overlap it on a narrow window.
- The thread of questions and answers floats above the bar, follows the newest
  answer, and is the one place a scroll is unavoidable: a chat panel cannot grow
  past the window.
- The thread **opens and closes** from the chevron at the right of the bar, which
  is the same control in both states (pointing up at the panel it will bring back,
  down at where it will go), counts what is in it in its label (`Hide the 2
  questions and answers`), and appears only once there is something to show.
  Asking always opens it — the answer is the point of the question — and the
  open/closed choice is remembered in `gather.ask.thread` across reloads.
- The hint beside the bar says why the box is not usable yet (`Add an AI key in
  Settings`, `Unlocks once notes are written`, `Off in local-only mode`,
  `Answering…`), and the notes sections above stay exactly where they were. It is
  a chip, because the document scrolls behind it.

## Requirements

- Windows 10/11
- Current Google Chrome or Microsoft Edge
- Node.js 18+
- A Teams or Zoom desktop meeting with system audio available
- HTTPS or `localhost` (required by browser media permissions)

## Stage 3 backend intelligence protocol

The browser may POST finalized transcript text to:

```text
POST /v1/intelligence/rolling
Content-Type: application/json
Authorization: Bearer <optional BROWSER_API_TOKEN>
```

Payloads contain only finalized text segments joined into a bounded transcript:

```json
{ "session_id": "web-…", "transcript": "final text only", "final": false }
```

The browser never sends raw audio or screen video. `GET /v1/config/status` reports provider/model readiness without returning secrets. The FastAPI service defaults to localhost-only CORS origins, validates payload sizes, applies a basic per-client rate limit, and supports an optional bearer token via `BROWSER_API_TOKEN`.

Local-only privacy mode is enabled by default in the browser UI and prevents every intelligence request. If DeepSeek is unavailable, local transcription and IndexedDB persistence continue.

## Interface

The web client is a dependency-free vanilla TypeScript app (`index.html` + `src/main.ts` + `src/styles.css`) — no UI framework is required for this scope.

Four views share one shell (navigation rail + main region):

1. **Meeting library** — search, date-grouped meeting rows (Today, Yesterday, Previous 7 days, Older), hover actions for open/export/delete, and an empty state. A meeting is stored as soon as it has produced anything — words, screen captures, typed notes or kept audio — or has simply run for five seconds, so a silent meeting or one where only slides were shared is still listed rather than vanishing; those rows say what they do have (`No speech transcribed · 2 screen captures`) and the flag reads *Nothing captured* instead of claiming a transcript. A search that matches nothing says how many meetings it is hiding and offers **Clear search**, because "no meetings" and "filtered out" must not look the same.
2. **Preparation** — editable meeting title, microphone / system-audio / display-surface status, and one primary "Start meeting" action. Settings live on their own page, reachable from the rail or a link at the bottom of the capture panel.
3. **Live workspace** — editorial notes document (personal notes plus editable Summary, Key points, Decisions, Action items and Open questions, which fill in from AI notes as the meeting runs), which flows as a page and whose section titles open the content each section was written from; a transcript / AI-activity panel with search, auto-scroll and copy, where the transcript and the AI log each scroll in their own region; **Ask about this meeting** as a floating bar at the foot of the page (see its own section below); and a floating control bar (status, elapsed time, microphone and system-audio levels, the newest screen capture, **Share again** when the shared surface is lost, pause/resume, end meeting). A running meeting does not trap you: the rail stays available, the bar follows you to every view, and **Open meeting** brings you back.
4. **Completed meeting** — transcript and notes preserved, "Finalising notes" progress, Copy / Export Markdown / Delete, and a non-blocking provider error with Retry. **Ask about this meeting** is not part of this item any more: it is a floating bar on the meeting page (see below), live or completed.
5. **Settings** — Privacy (local-only mode, meeting audio), the speech-to-text and AI-notes tabs when local-only mode is off, the shared key vault, and Local Whisper (model, chunk, overlap, compute) which is always available.

The settings page follows local-only mode. **Both tabs are cloud features** — a speech engine that streams audio away and a notes provider that receives text — so turning local-only mode on hides the tab row, both panels and the key vault, leaving Privacy and Local Whisper. That is also why the capture switches live where they do: *Summarise shared screens* and *Keep the frame with each capture* are vision-provider settings and sit with AI notes, while *Save the meeting audio* stays on this device and sits in the Privacy block, reachable either way.

### What is remembered

Every choice made here is stored in this browser and comes back on the next
reload:

| Choice | Stored in |
| --- | --- |
| Local-only mode | `gather.asr.v1` (`localOnly`) |
| Speech engine, Deepgram model and language | `gather.asr.v1` |
| Local Whisper model, window (chunk) and overlap | `gather.asr.v1` |
| Save the meeting audio / summarise screens / keep the frame | `gather.asr.v1` |
| Compute (GPU or CPU only) | `gather.backend` |
| AI provider, model, base URL and vision model | `gather.ai.v1` |
| Keys | session storage, or the encrypted vault |
| Whether the answer thread is open | `gather.ask.thread` |
| Collapsed navigation rail | `gather.rail.collapsed` |

Local-only mode and the Whisper window used to live only in the markup, so a
reload silently turned local-only mode back on and reset the window to 6/2 —
anyone whose key was locked in the vault had to turn it off again before every
meeting. The stored mode is a record of the user's own decision, and
`allowCloudAudioWhenChosen()` writes it too: choosing Deepgram with a key is
already an explicit decision to send audio off the device, so the next reload no
longer re-arms the switch that would block it.

## What to pick in the share dialog

Sharing a **window** is not impossible — Chrome's picker lists native app windows, so a desktop Teams or Zoom window can be shared on its own, and on Windows the same picker offers *Share system audio* for a window. What varies by platform is that audio: per [Chrome's own guidance](https://developer.chrome.com/blog/avoiding-oversharing-when-screen-sharing), tab audio is supported everywhere while system and window audio are platform-dependent, and the picker has defaulted to **tabs** since Chrome 107 precisely because screens are the least private option — a shared screen exposes the clock, notifications, other running apps, extensions and bookmarks.

So, in order of preference:

1. **A web meeting in a tab** — the tab always carries its own audio, and the capture can only ever show that tab.
2. **The meeting window** — a desktop Teams/Zoom window on its own, with *Share system audio* ticked if the platform offers it.
3. **Entire Screen** — only when the audio needs it. This is the one case where the vision model can see everything else on your desktop, which is why the app names the surface it was given and warns when it is the whole monitor.

Screen reading cannot be restricted to "the meeting" by the app itself: the browser deliberately hands the choice to the user. The app narrows it as far as it can — no switching surfaces mid-meeting, never its own tab, and it names what it got.

### AI activity

The **AI activity** tab is a changelog, not a snapshot: every AI update appends one timestamped line saying what moved — `Summary rewritten · 2 new key points`, `1 decision dropped`, `Final notes · unchanged · 3 key points, 1 action item` — alongside each shared-screen read, each question asked and any provider error. Consecutive identical failures collapse into one row whose timestamp stays current, so a provider that is down overnight cannot bury the log. Every `Notes updated` and `Final notes` row also carries the pass it was written from, so **What it read** opens the transcript lines and screen captures behind that exact line. The tab is the log and nothing else — the notes themselves are the document to its left, so the log no longer repeats them as a "Latest notes" block. The log scrolls in its own region, beside the transcript's own scroll. The log is stored with the meeting — including the pass each row points at — and comes back when it is reopened.

Questions and answers are stored with the meeting too, so a meeting can be re-opened and asked about days later. A question carries the **whole timestamped transcript**, and the notes are included only as a guide the model is told to overrule when the transcript disagrees with them — the transcript is the record, so an answer about minute 3 of a two-hour meeting is still grounded in what was actually said. The final notes pass reads the whole transcript for the same reason (the rolling pass is the only one that works from a recent tail, and that is a cost decision). Nothing but that material, plus the question, is sent to the configured provider.

## Real-time transcription with Deepgram

`Settings → Speech-to-text` chooses the engine:

- **Deepgram (default once a key is present)** — the browser opens a WebSocket
  straight to `wss://api.deepgram.com/v1/listen` with the user's key (sent as
  the `token` sub-protocol, so it never appears in a URL) and streams 100 ms
  frames of 16 kHz mono PCM16 from the mixed meeting audio. Results are
  **finals only**: each finished sentence is appended once, so nothing on screen
  is rewritten while someone is talking. Final results carry word timestamps and
  become ordinary transcript segments, so notes, search, history and export are
  unchanged. Nothing is downloaded or compiled, so a meeting starts instantly.
- **Local Whisper** — offline, nothing leaves the device, updates every few
  seconds.

Choosing Deepgram turns local-only mode off (a cloud engine has to receive
audio) and the settings copy says so. If the socket cannot be established, or
drops repeatedly, the app reports why and **continues the meeting on local
Whisper** instead of losing the transcript. The Deepgram key lives in the same
key store as the AI keys: session memory by default, or the encrypted vault when
it is unlocked. Audio is billed by Deepgram per minute; their free credit covers
thousands of minutes.

## AI notes without a backend (bring your own key)

The frontend can generate the same notes as the FastAPI service — `{title, executiveSummary, keyPoints, decisions, actionItems, questions}` — by calling a model provider directly. Keys are entered in Settings and stored only in this browser's `localStorage`; they are never written to IndexedDB meeting records, never included in Markdown exports, and never sent anywhere except the chosen provider.

### Which providers work from a browser

Measured from a real page origin (both `https://` and `http://localhost`) with an invalid key, checking that the request reached the provider and the error body was readable:

| Provider           | Browser-callable                                                                                               | Evidence                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek           | Yes                                                                                                            | 401 `authentication_error` readable                                                                                                                                              |
| OpenAI             | **Only via a base URL override**                                                                               | Preflight returns 200, but the POST response omits `Access-Control-Allow-Origin`, so `fetch` rejects with "Failed to fetch"; an authorised `GET /v1/models` returns 401 readable |
| Claude (Anthropic) | Yes, **only** with the `anthropic-dangerous-direct-browser-access: true` header, which the client always sends | 401 `authentication_error` readable                                                                                                                                              |
| Google Gemini      | Yes, with the key in the `x-goog-api-key` header (never the query string)                                      | 400 `API key not valid` — an auth error, so the request shape is accepted                                                                                                        |
| OpenRouter         | Yes; one key reaches GPT, Claude and Gemini models                                                             | 401 readable                                                                                                                                                                     |
| Custom server      | Yes, when you run it                                                                                           | Posts the FastAPI payload to `/v1/intelligence/rolling`                                                                                                                          |

### Making OpenAI work

OpenAI's browser policy has flip-flopped: an [outage on 15 Oct 2025](https://community.openai.com/t/chat-completions-api-endpoint-down-blocked-any-web-browser-request/1362527) removed `Access-Control-Allow-Origin` from Chat Completions (an OpenAI staff member confirmed it as a bug, and it was fixed the same day), and a [January 2026 report](https://community.openai.com/t/has-the-cors-policy-changed-responses-api/1372791/5) had Chat Completions working while `/v1/responses` was blocked. The OpenAI entry is therefore kept and selectable, with two ways to use it today:

1. **API base URL** (Settings → AI notes). Accepted forms are a bare host, a host plus `/v1`, or a full completion path — Azure deployments need the last one, e.g. `https://x.openai.azure.com/openai/deployments/d/chat/completions`. Verified end to end against a local OpenAI-compatible server: the app sends `POST {base}/chat/completions` with `Authorization: Bearer <key>`, `model`, `response_format: {type:"json_object"}` and the system/user prompt, then renders the returned notes.
2. **OpenRouter**, which reaches GPT models through its own key.

If OpenAI restores the header, the entry works with no code change — and the error message says exactly that instead of blaming your network.

`src/intelligence/client.test.ts` pins the wire format of each provider (endpoints, headers, JSON mode, base-URL normalisation) and every user-facing error message. `src/intelligence/notes.test.ts` covers JSON repair (code fences, prose, nested braces) and coercion of responses into the note contract.

### How the key is stored

Keys are never written to `localStorage` in plain text.

| Choice                                        | Where the key lives                                                                          | Cleared                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| Type a key and leave "Remember" off (default) | `sessionStorage`, plus memory                                                                | when the tab closes        |
| Tick "Remember this key on this device"       | AES-256-GCM ciphertext in `localStorage` (`gather.ai.vault.v1`), unlocked by your passphrase | never, until you forget it |

The vault derives its key from your passphrase with PBKDF2-HMAC-SHA256 (600,000 iterations, random 16-byte salt, random 12-byte IV per write). The passphrase itself is never stored, the derived key exists only in memory, and "Lock now" both drops that key and clears the session copy so the key stops being used. Unlocking lasts for the session; a reload comes back locked.

**What this protects against:** another person using this browser profile, a synced or backed-up `localStorage` dump, casual inspection in DevTools, and a stolen disk.

**What it does not protect against:** code running in the page while the vault is unlocked. Decrypting puts the key in memory because the provider request needs it, so XSS or an extension with page access can read it either way. Encryption protects the key at rest, not in use. Only a proxy keeps the secret out of the browser entirely.

A plaintext `keys` map written by an earlier version is migrated into the session on first load and deleted from `localStorage`.

### Cost control

Rolling notes are throttled to one request every 25 seconds plus a final pass when the meeting ends (`ROLLING_INTERVAL_MS`), and overlapping requests are skipped. Both are deliberate: an unthrottled per-segment call would bill the user's key continuously.

## Hosting on GitHub Pages

The repository ships a workflow at `.github/workflows/deploy-web.yml` that builds `apps/web` and publishes `dist/` to GitHub Pages.

### Enable Pages once

1. Open the repository on GitHub → **Settings** → **Pages** (left sidebar, under "Code and automation").
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open the **Actions** tab → **Deploy web app to GitHub Pages** → **Run workflow** (branch `main`).

The site is live at **https://adonishhh772.github.io/Transcriber-agent/** (Pages `status: built`, HTTPS enforced). Verified after deploy: no failed requests, styles applied, navigation working, and `isSecureContext` with Web Crypto available so the key vault works.

The first run after pushing fails at the _Configure Pages_ step while Pages is still disabled — that is expected. Enable Pages as above, then re-run the workflow (or push another commit to `apps/web/**`).

The site appears at `https://<owner>.github.io/<repo>/`, e.g. `https://adonishhh772.github.io/Transcriber-agent/`. Every later push to `main` that touches `apps/web/**` redeploys automatically.

### Why the build is portable

`vite.config.ts` sets `base: "./"`, so assets resolve relatively and the same build works at a domain root, under `/<repo>/`, or in a subfolder. This was verified by serving `dist/` under a `/Transcriber-agent/` prefix: no 404s, styles applied, navigation working.

### Notes specific to Pages

- Pages serves over HTTPS, which the app needs: `getDisplayMedia`, the microphone, WebGPU, WASM workers, IndexedDB, `crypto.randomUUID` and the Web Crypto vault all require a secure context.
- Pages cannot send `COOP`/`COEP` headers, so onnxruntime's threaded WASM build likely falls back to single-threaded. WebGPU is unaffected.
- The Whisper model is downloaded from the HuggingFace CDN on first use (~75 MB for `tiny.en`). That works from Pages but can be blocked on locked-down networks.
- Everything else is client-side: no server, no build-time secrets, and API keys never leave the browser.

### Design system

Tokens are declared once in `:root` in `styles.css`: surfaces (`--background`, `--surface`, `--surface-secondary`, `--surface-tertiary`, `--rail`, `--accent-wash`), text (`--text-primary`, `--text-secondary`, `--text-muted`), lines (`--border`, `--border-strong`), accents (`--accent`, `--accent-dark`, `--accent-deep`, `--accent-soft`, `--success`, `--warning`, `--danger`), type stacks (`--font-sans`, `--font-serif`, `--font-mono`), radii, elevation and motion timing.

- Type uses locally available families only (system sans, an editorial serif stack, a system monospace). No web-font download is required, so the interface renders identically offline.
- Icons are inline SVG symbols defined once in `index.html` and referenced with `<use>`; no icon font or CDN is loaded.
- Text tokens were darkened from the reference palette so every text pair clears WCAG AA 4.5:1 on the warm background (`--text-muted` 4.51:1, `--text-secondary` 6.33:1, `--accent-dark` 5.2:1, `--danger` 5.18:1).
- Motion is intentionally small: 170–300 ms transitions, a slow pulse on the recording dot, upward fade for transcript segments, a fading highlight when AI sections update, and skeletons while notes generate. `prefers-reduced-motion` disables all of it.
- Responsive: three regions at ≥1200 px; below that the rail collapses to icons and the transcript becomes an overlay drawer so the note editor keeps a usable measure.

## Commands

From the repository root:

```powershell
cd apps/web
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

Quality checks:

```powershell
cd apps/web
npm run format:check
npm run typecheck
npm test
npm run build
```

To apply formatting:

```powershell
cd apps/web
npm run format
```

## Manual Teams/Zoom checklist

1. Start the web app from `localhost` or a trusted HTTPS origin in Chrome or Edge.
2. Open the **desktop** Microsoft Teams or Zoom app and join a test meeting.
3. Make sure a remote participant, meeting chime, or test video produces audible system audio.
4. Open **New meeting** and click **Start meeting**. Do not start capture from the address bar or another action.
5. In the browser picker, select **Entire Screen** first. This is the most reliable Windows path for system audio.
6. Enable **Share system audio** in the picker. If the checkbox is not enabled, cancel and try again.
7. Approve the microphone prompt and speak into the selected microphone.
8. Confirm the capture setup panel shows:
   - `System audio: Received`
   - `Microphone permission: granted`
   - A display surface, when Chrome/Edge exposes it
9. Confirm the System audio level moves when Teams/Zoom audio plays.
10. Confirm the Microphone level moves when you speak.
11. Confirm the Mixed level moves for either source.
12. Confirm the duration increments while capture is active.
13. Click **End meeting**, confirm the dialog, and verify the workspace moves to the completed state, meters return to zero, and the transcript is still present.
14. Inspect DevTools Network: this prototype must make no API requests and must show no video upload.
15. Repeat with a Zoom meeting and a Teams meeting.
16. Repeat by choosing a window instead of Entire Screen and document whether the browser offers system audio. The required error is shown if no system-audio track is returned:

`No meeting audio was shared. In the picker, share the meeting window (or Entire Screen) and tick Share system audio — or a browser tab with Share tab audio.`

17. With **Summarise shared screens** on, confirm the toast names the surface that was picked (`Screen reading is limited to the shared window`, or the whole-screen warning), and that the picker offers no way to switch surfaces afterwards.
18. With a window shared, minimise that window (or press the browser's *Stop sharing*): the meeting must **keep recording** — the microphone level still moves, the transcript still grows, a warning names the lost surface, and **Share again** brings system audio back with no gap in the transcript. Confirm the meeting only ends from **End meeting** (or Escape, which asks first).
19. Click a note section title while notes are present and confirm the panel shows the timestamped transcript lines and screen captures that pass was given, that **Copy content** copies them, and that they are still there after a reload.
20. On the **AI activity** tab, confirm the log scrolls inside its own region rather than pushing the counters off the page, that it no longer repeats the notes as a "Latest notes" block, and that **What it read** on a `Notes updated` row opens the content behind that line (and closes again).
21. Confirm the **ask bar** floats at the foot of the meeting page on both a live and a completed meeting, that it sits just above the recording bar while one runs (including when a screen capture appears in that bar and it grows), and that it is absent on the library, prepare and settings pages. Confirm the bar is centred from its first frame, that the answer thread opens and closes from the chevron (and that the choice survives a reload), and that asking opens the thread again.
22. Change local-only mode, the Whisper model, the chunk and the overlap, reload the page, and confirm all four come back as they were set.

## Production review status

- Capture cleanup stops display, microphone, mixed destination, and output tracks; disconnects Web Audio nodes; closes the AudioContext; and disposes the Whisper worker.
- The display video track is never uploaded as video: when *Summarise shared screens* is on, the app draws one frame every ~25 seconds into a 640px-wide canvas, sends that downscaled JPEG to the configured vision model, and keeps the returned text. The 320px thumbnail kept alongside it is local-only, deleted with the meeting, and sent nowhere.
- System audio comes from the display audio track and microphone audio comes from the separate microphone stream, avoiding duplicate input selection.
- Transcript rendering uses DOM text nodes rather than unsafe HTML interpolation. Markdown export contains text only.
- IndexedDB schema version 4 adds `screenNotes`, `aiActivity` and `qa` to a meeting record; the notes-sample log (`noteSources` plus the per-section `noteSourceRef`) is more optional fields on the same store, so the schema version is unchanged. Future changes must increment `MEETING_SCHEMA_VERSION` and migrate records.
- Unsupported browser messaging is shown when required capture APIs are missing. WebGPU model-load failure retries with WASM.
- Rolling intelligence requests are debounced and bounded to the latest 100 segments to keep the cost of a long meeting sane. The final notes pass and every question read the **whole** transcript; requests abort after 45 seconds. Local transcription and persistence continue after DeepSeek outage or timeout.
- Keyboard controls include Tab/Enter with visible focus rings, Space to pause or resume while the page body is focused, and Escape to close the frame preview, close the end-meeting dialog, or open that dialog rather than stopping capture.

## Known limitations

- Chrome/Edge control which display surfaces expose system audio, and the app cannot restrict the picker to one surface — the choice belongs to the user. It can only refuse to switch surfaces mid-meeting, exclude its own tab, and say afterwards which surface it was given. Tab audio is supported on every platform; window and system audio are not, which is the one reason to share an entire screen.
- The prototype keeps the video track for the transcript and, when screen summarising is on, for one downscaled frame every ~25 seconds. It never records video, never connects it to storage, and never uploads a frame when that setting is off (or in local-only mode, which refuses to read screens at all).
- The browser can now send finalized transcript text to the optional FastAPI intelligence endpoint. Raw audio and display video are never uploaded; screen frames go to the configured vision provider only while *Summarise shared screens* is on, and only as a description is anything kept.
- Browser Whisper support is intended for current Chrome/Edge builds with WebGPU; browsers without WebGPU use the WASM path. Performance observations should be recorded during manual testing as model download time, first-result latency, sustained transcription lag, and memory pressure.
- The display-surface label is browser-dependent and may be `Not selected` even when a display was selected.
- No server-side or application-level permission persistence is implemented; browser permissions remain controlled by Chrome/Edge.
