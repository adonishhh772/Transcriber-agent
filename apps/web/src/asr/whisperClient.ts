import type { TranscriptSegment } from "../transcript/dedup";
import type {
  WhisperBackend,
  WhisperWorkerRequest,
  WhisperWorkerResponse,
} from "./protocol";

export type WhisperClientOptions = {
  model: string;
  language?: string;
  onProgress?: (progress: number, status: string) => void;
  onBackend?: (backend: WhisperBackend) => void;
  onError?: (message: string) => void;
};

/** A download that reports nothing for this long is treated as stalled. */
const LOAD_STALL_MS = 120_000;
const STALL_MESSAGE =
  "The Whisper model download stalled. Check your connection, then reload the model.";

export class WhisperClient {
  private readonly worker: Worker;
  private readonly options: WhisperClientOptions;
  private nextId = 1;
  private pending = new Map<
    number,
    (segment: TranscriptSegment | null) => void
  >();
  private loadPromise: Promise<void> | null = null;
  private failLoad: ((error: Error) => void) | null = null;
  private stallTimer: number | null = null;
  private disposed = false;

  constructor(options: WhisperClientOptions) {
    this.options = options;
    this.worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<WhisperWorkerResponse>) =>
      this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      /* Without this the load promise would never settle and the UI would sit
         on "Loading the Whisper model…" forever. */
      const message = event.message || "Whisper worker error";
      this.options.onError?.(message);
      this.failLoad?.(new Error(message));
    };
  }

  /**
   * Idempotent: concurrent calls join the first load instead of starting a
   * second download, and a loaded model is reused.
   */
  async load(): Promise<void> {
    if (this.disposed) throw new Error("Whisper client disposed");
    if (this.loadPromise) return this.loadPromise;
    /* Assign before the first await: probing the GPU adapter is asynchronous,
       and two callers would otherwise both start loading. */
    this.loadPromise = this.detectBackendAndLoad();
    return this.loadPromise;
  }

  private async detectBackendAndLoad(): Promise<void> {
    const backend: WhisperBackend = (await supportsWebGpu())
      ? "webgpu"
      : "wasm";
    this.options.onBackend?.(backend);
    await this.startLoading(backend);
  }

  /** Loads once, retrying on WASM when WebGPU cannot initialise. */
  private startLoading(backend: WhisperBackend): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const settle = () => {
        this.worker.removeEventListener("message", listener);
        this.clearStall();
        this.failLoad = null;
      };
      const fail = (error: Error) => {
        settle();
        reject(error);
      };
      const listener = (event: MessageEvent<WhisperWorkerResponse>) => {
        const message = event.data;
        if (message.type === "loaded") {
          settle();
          resolve();
          return;
        }
        if (message.type === "progress") {
          this.armStall(() => fail(new Error(STALL_MESSAGE)));
          return;
        }
        if (message.type !== "error") return;
        if (backend === "webgpu") {
          this.options.onBackend?.("wasm");
          settle();
          this.startLoading("wasm").then(resolve, reject);
          return;
        }
        fail(new Error(message.message));
      };
      this.failLoad = fail;
      this.worker.addEventListener("message", listener);
      this.armStall(() => fail(new Error(STALL_MESSAGE)));
      this.worker.postMessage({
        type: "load",
        model: this.options.model,
        backend,
      } satisfies WhisperWorkerRequest);
    });
  }

  private armStall(onStall: () => void): void {
    this.clearStall();
    this.stallTimer = window.setTimeout(onStall, LOAD_STALL_MS);
  }

  private clearStall(): void {
    if (this.stallTimer !== null) window.clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  async transcribe(
    audio: Float32Array,
    startMs: number,
    endMs: number,
  ): Promise<TranscriptSegment | null> {
    if (this.disposed) return null;
    await this.load();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      try {
        this.worker.postMessage(
          {
            type: "transcribe",
            id,
            audio,
            startMs,
            endMs,
            language: this.options.language ?? "en",
          } satisfies WhisperWorkerRequest,
          [audio.buffer],
        );
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearStall();
    this.failLoad?.(new Error("Whisper client disposed"));
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
    this.worker.postMessage({ type: "dispose" } satisfies WhisperWorkerRequest);
    this.worker.terminate();
  }

  private handleMessage(message: WhisperWorkerResponse): void {
    if (this.disposed) return;
    if (message.type === "progress")
      this.options.onProgress?.(message.progress, message.status);
    if (message.type === "segment")
      this.pending.get(message.id)?.(message.segment);
    if (message.type === "segment") this.pending.delete(message.id);
    if (message.type === "error") {
      this.options.onError?.(message.message);
      if (message.id !== undefined) {
        this.pending.get(message.id)?.(null);
        this.pending.delete(message.id);
      }
    }
  }
}

async function supportsWebGpu(): Promise<boolean> {
  /* `"gpu" in navigator` is not enough: Chrome exposes the object even when no
     adapter is available (software rendering, blocked GPU), and a failed load
     then costs a full model download before falling back to WASM. */
  if (typeof navigator === "undefined") return false;
  const gpu = (navigator as Navigator & {
    gpu?: { requestAdapter?: () => Promise<unknown | null> };
  }).gpu;
  if (typeof gpu?.requestAdapter !== "function") return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}
