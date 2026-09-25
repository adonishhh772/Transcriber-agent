# Transcriber Agent

Browser-local meeting transcription. Speech is transcribed on the device, and every saved meeting is sealed in the same passphrase vault as remembered API keys.

## What it does

- Captures the microphone and the shared display audio in the browser.
- Transcribes with a local Whisper model, or with Deepgram when a key is set.
- Drafts notes with the AI provider you choose (DeepSeek, OpenAI, Claude, Gemini, OpenRouter, or a custom server).
- Keeps the meeting library on this device. Transcripts, notes, screen notes, questions, and optional audio are encrypted before they are written.

## Vault

One passphrase protects two stores:

| What | Where | How |
| --- | --- | --- |
| API keys | `localStorage` | AES-256-GCM |
| Meetings and audio | IndexedDB (`transcriber-meetings`) | AES-256-GCM, same key |

The key is derived with PBKDF2-HMAC-SHA256 (600,000 iterations). The passphrase is never stored. Until you unlock the vault, the library stays locked and a new meeting cannot start. Locking hides meetings again and clears session keys.

Forgetting an API key does not erase the vault. The meetings are sealed with that same key, so wiping it would make them unreadable. A locked vault must be unlocked before a key can be removed.

This protects a copied browser profile, a backup of local storage, and casual inspection of the database. It does not protect the page while the vault is unlocked: the decrypted meeting is in memory so it can be shown.

## Repository

| Path | Role |
| --- | --- |
| `apps/web` | The meeting app (Vite + TypeScript) |
| `apps/api` | Optional FastAPI service for live sessions |
| `apps/desktop` | Electron shell |
| `services` | ASR, LLM, and the live graph used by the API |

## Run the web app

```bash
cd apps/web
npm install
npm test
npm run dev
```

Open the URL Vite prints (localhost). Create a vault passphrase on the meetings screen before the first meeting. HTTPS or localhost is required because the vault uses Web Crypto.

## Run the API

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn apps.api.main:app --reload
```

The browser app does not need this process for local Whisper transcription.

## Tests

From `apps/web`:

```bash
npm test
npm run typecheck
```
