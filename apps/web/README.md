# Browser-local meeting transcription prototype

Stages 1–2 are local-only Windows Chrome/Edge prototypes. The app asks the user to choose a display and microphone, mixes the two audio paths in the Web Audio API, and runs configurable English Whisper transcription in a dedicated browser worker. It does **not** send audio or screen video to the backend, and it does not implement DeepSeek.

## Stage 2 local Whisper

The default configurable model identifier is `Xenova/whisper-tiny.en`. The worker currently isolates model loading, backend selection, progress reporting, chunk scheduling, and cleanup. The model-runtime adapter is the boundary for wiring the chosen browser Whisper package and quantized model artifacts; no inference request leaves the browser.

Recommended company-laptop starting point:

- `Xenova/whisper-tiny.en`: approximately 75–150 MB downloaded depending on quantization/runtime files; typically several hundred MB of working memory.
- A quantized base English model can improve accuracy but may require roughly 2–4x the download and memory budget.
- Actual memory, load time, and real-time factor depend heavily on CPU, GPU, browser version, and model files.

The UI defaults to 6-second chunks with 2 seconds of overlap, suppresses low-RMS chunks, and deduplicates repeated boundary words. Chunk and overlap values are configurable before capture.

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

1. **Meeting library** — search, date-grouped meeting rows (Today, Yesterday, Previous 7 days, Older), hover actions for open/export/delete, and an empty state.
2. **Preparation** — editable meeting title, microphone / system-audio / display-surface status, and one primary "Start meeting" action. Settings live on their own page, reachable from the rail or a link at the bottom of the capture panel.
3. **Live workspace** — editorial notes document (personal notes plus editable Summary, Key points, Decisions, Action items and Open questions), a transcript / AI-activity panel with search, auto-scroll and copy, and a floating control bar (status, elapsed time, microphone and system-audio levels, pause/resume, end meeting).
4. **Completed meeting** — transcript and notes preserved, "Finalising notes" progress, Copy / Export Markdown / Delete, and a non-blocking provider error with Retry.
5. **Settings** — Privacy (local-only mode), AI notes (provider, model, key, test, forget) and Transcription (Whisper model, chunk, overlap).

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

`No system audio was shared. Select Entire Screen and enable Share system audio.`

## Production review status

- Capture cleanup stops display, microphone, mixed destination, and output tracks; disconnects Web Audio nodes; closes the AudioContext; and disposes the Whisper worker.
- The display video track is never sent to the backend. System audio comes from the display audio track and microphone audio comes from the separate microphone stream, avoiding duplicate input selection.
- Transcript rendering uses DOM text nodes rather than unsafe HTML interpolation. Markdown export contains text only.
- IndexedDB schema version 2 adds `updatedAt` and `title` indexes. Future changes must increment `MEETING_SCHEMA_VERSION` and migrate records.
- Unsupported browser messaging is shown when required capture APIs are missing. WebGPU model-load failure retries with WASM.
- Intelligence requests are debounced, bounded to the latest 100 finalized segments, and aborted after 30 seconds. Local transcription and persistence continue after DeepSeek outage or timeout.
- Keyboard controls include Tab/Enter with visible focus rings, Space to pause or resume while the page body is focused, and Escape to close the end-meeting dialog or stop capture.

## Known limitations

- Chrome/Edge control which display surfaces expose system audio; the app cannot override a missing browser picker option.
- The prototype intentionally keeps the video track only long enough to identify and stop it during cleanup. It never connects video to an output, recorder, request, or storage.
- The browser can now send finalized transcript text to the optional FastAPI intelligence endpoint. Raw audio and display video remain local and are never sent. Enable local-only privacy mode by not configuring the backend request path.
- Browser Whisper support is intended for current Chrome/Edge builds with WebGPU; browsers without WebGPU use the WASM path. Performance observations should be recorded during manual testing as model download time, first-result latency, sustained transcription lag, and memory pressure.
- The display-surface label is browser-dependent and may be `Not selected` even when a display was selected.
- No server-side or application-level permission persistence is implemented; browser permissions remain controlled by Chrome/Edge.
