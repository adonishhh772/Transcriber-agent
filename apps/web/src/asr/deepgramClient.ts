/**
 * Deepgram live transcription over a WebSocket.
 *
 * The browser connects straight to Deepgram with the user's key — there is no
 * server in this deployment — and streams 16 kHz mono PCM16 frames. Interim
 * results arrive while the speaker is still talking; final results carry word
 * timestamps and become ordinary transcript segments, so notes, history,
 * search and export are unchanged.
 *
 * Authentication uses the `token` WebSocket sub-protocol, which Deepgram
 * documents for browser clients: the key travels in a header rather than a
 * URL, so it never lands in logs or history. If that is rejected the client
 * retries once with `?access_token=`, which covers temporary keys.
 */

import { float32ToPcm16 } from "../audio/pcm";
import type { TranscriptSegment } from "../transcript/dedup";

export type DeepgramStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

export type DeepgramClientOptions = {
  apiKey: string;
  model?: string;
  language?: string;
  sampleRate?: number;
  onInterim?: (text: string) => void;
  onFinal?: (segment: TranscriptSegment) => void;
  onStatus?: (status: DeepgramStatus, detail?: string) => void;
  onError?: (message: string) => void;
};

const ENDPOINT = "wss://api.deepgram.com/v1/listen";
const KEEP_ALIVE_MS = 8_000;
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 8_000;
/** Attempts before the engine gives up and the app falls back to local. */
const MAX_ATTEMPTS = 3;

type DeepgramWord = {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
};

type DeepgramMessage = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
  duration?: number;
  channel?: {
    alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }>;
  };
  description?: string;
  message?: string;
};

export function buildListenUrl(options: {
  model: string;
  language: string;
  sampleRate: number;
}): string {
  const params = new URLSearchParams({
    model: options.model,
    language: options.language,
    encoding: "linear16",
    sample_rate: String(options.sampleRate),
    channels: "1",
    /* Finals only: interim results rewritten the same line as the speaker
       talked, which looks like text being replaced. Each finished sentence is
       appended once instead. */
    interim_results: "false",
    smart_format: "true",
    punctuate: "true",
    vad_events: "true",
  });
  return `${ENDPOINT}?${params.toString()}`;
}

export class DeepgramStreamingClient {
  private readonly options: DeepgramClientOptions & {
    model: string;
    language: string;
    sampleRate: number;
  };
  private socket: WebSocket | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private active = false;
  private usedQueryAuth = false;
  private currentStatus: DeepgramStatus = "idle";

  constructor(options: DeepgramClientOptions) {
    this.options = {
      model: "nova-3",
      language: "en",
      sampleRate: 16_000,
      ...options,
    };
  }

  get status(): DeepgramStatus {
    return this.currentStatus;
  }

  /** Opens the socket. Resolves once it is open, rejects on a hard failure. */
  async connect(): Promise<void> {
    this.active = true;
    this.attempts = 0;
    await this.openSocket();
  }

  private openSocket(): Promise<void> {
    this.setStatus(this.attempts > 0 ? "reconnecting" : "connecting");
    const url = buildListenUrl({
      model: this.options.model,
      language: this.options.language,
      sampleRate: this.options.sampleRate,
    });
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = this.usedQueryAuth
          ? new WebSocket(
              `${url}&access_token=${encodeURIComponent(this.options.apiKey)}`,
            )
          : new WebSocket(url, ["token", this.options.apiKey]);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("WebSocket failed"));
        return;
      }
      this.socket = socket;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        reject(new Error("Deepgram did not answer within 15 seconds."));
      }, CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.attempts = 0;
        this.startKeepAlive();
        this.setStatus("open");
        resolve();
      };
      socket.onmessage = (event) =>
        this.handleMessage(typeof event.data === "string" ? event.data : "");
      socket.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(
          new Error(
            "Could not reach Deepgram. Check the key, your connection or an ad blocker.",
          ),
        );
      };
      socket.onclose = (event) => {
        this.stopKeepAlive();
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(this.describeClose(event));
          return;
        }
        this.handleFailure(this.describeClose(event));
      };
    });
  }

  /**
   * Single retry ladder: a dropped socket, a failed handshake and a rejected
   * upgrade all end up here, so a connection that never opens still retries
   * (and eventually reports an error rather than waiting forever).
   */
  private handleFailure(cause: Error): void {
    if (!this.active) return;
    if (this.reconnectTimer !== null) return; // already scheduled
    this.attempts += 1;
    if (this.attempts > MAX_ATTEMPTS) {
      this.active = false;
      this.setStatus("error", cause.message);
      this.options.onError?.(cause.message);
      return;
    }
    /* A key sent as a sub-protocol can be refused by proxies; try the query
       form once before giving up. */
    if (this.attempts === 1 && !this.usedQueryAuth) this.usedQueryAuth = true;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** (this.attempts - 1));
    this.setStatus("reconnecting", `retrying in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.active) return;
      this.openSocket().catch((error: Error) => this.handleFailure(error));
    }, delay);
  }

  private describeClose(event: CloseEvent): Error {
    const detail = event.reason ? ` (${event.reason})` : "";
    if (event.code === 1008 || event.code === 4001 || event.code === 401)
      return new Error(`Deepgram refused the connection${detail}. Check the API key.`);
    if (event.code === 402)
      return new Error("Deepgram reports no remaining credit for this key.");
    return new Error(`The Deepgram connection closed (${event.code})${detail}.`);
  }

  /** Streams one buffer of mono float samples. */
  send(samples: Float32Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || samples.length === 0)
      return;
    try {
      socket.send(float32ToPcm16(samples));
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error.message : "Could not send audio.",
      );
    }
  }

  async close(): Promise<void> {
    this.active = false;
    this.stopKeepAlive();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "CloseStream" }));
    } catch {
      /* the socket may already be gone */
    }
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    this.setStatus("closed");
  }

  private handleMessage(raw: string): void {
    if (!raw) return;
    let message: DeepgramMessage;
    try {
      message = JSON.parse(raw) as DeepgramMessage;
    } catch {
      return;
    }
    if (message.type === "Error" || message.type === "error") {
      const detail = message.description ?? message.message ?? "Deepgram error";
      this.options.onError?.(detail);
      return;
    }
    if (message.type !== "Results") return;

    const alternative = message.channel?.alternatives?.[0];
    const text = (alternative?.transcript ?? "").trim();
    if (!text) return;

    if (!message.is_final) {
      this.options.onInterim?.(text);
      return;
    }

    const start = message.start ?? 0;
    const duration = message.duration ?? 0;
    const words = (alternative?.words ?? [])
      .map((word) => ({
        w: (word.punctuated_word ?? word.word ?? "").trim(),
        t: Math.round((word.start ?? start) * 1000),
        end: Math.round((word.end ?? start + duration) * 1000),
      }))
      .filter((word) => word.w.length > 0);
    this.options.onInterim?.("");
    this.options.onFinal?.({
      text,
      startMs: Math.round(start * 1000),
      endMs: Math.round((start + duration) * 1000),
      confidence: undefined,
      ...(words.length ? { words } : {}),
    });
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAlive = setInterval(() => {
      const socket = this.socket;
      if (socket?.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify({ type: "KeepAlive" }));
      } catch {
        /* the close handler takes over */
      }
    }, KEEP_ALIVE_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAlive !== null) clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  private setStatus(status: DeepgramStatus, detail?: string): void {
    this.currentStatus = status;
    this.options.onStatus?.(status, detail);
  }
}
