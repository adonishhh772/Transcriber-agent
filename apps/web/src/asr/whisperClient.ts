import type { TranscriptSegment } from "../transcript/dedup";
import type {
  WhisperBackend,
  WhisperWorkerRequest,
  WhisperWorkerResponse,
} from "./protocol";

export type WhisperClientOptions = {
  model: string;
  language?: string;
  /** Skips the GPU probe: used as a compatibility escape hatch. */
  forceBackend?: WhisperBackend;
  onProgress?: (progress: number, status: string) => void;
  onBackend?: (backend: WhisperBackend) => void;
  onError?: (message: string) => void;
  /** Model time for one window, excluding any queue wait. */
  onTiming?: (ms: number) => void;
};

/** A download that reports nothing for this long is treated as stalled. */
const LOAD_STALL_MS = 120_000;
const STALL_MESSAGE =
  "The Whisper model download stalled. Check your connection, then reload the model.";

export class WhisperClient {
  private worker: Worker;
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
    this.worker = this.createWorker();
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WhisperWorkerResponse>) =>
      this.handleMessage(event.data);
    worker.onerror = (event) => {
      /* Without this the load promise would never settle and the UI would sit
         on "Loading the Whisper model…" forever. */
      const message = event.message || "Whisper worker error";
      this.options.onError?.(message);
      this.failLoad?.(new Error(message));
    };
    return worker;
  }

  /**
   * Runs one throwaway window so the runtime compiles its kernels now rather
   * than during the first window of a meeting — the first inference costs
   * 15-20s on both WASM and WebGPU, which looked exactly like a hung model.
   *
   * Returns false when the backend cannot finish it, which is also the test for
   * a GPU that stalls on quiet audio.
   */
  async warmUp(timeoutMs = 25_000): Promise<boolean> {
    if (this.disposed) return false;
    /* Audible synthetic audio: the point is to compile kernels, and a quiet
       buffer is exactly the input that can make Whisper loop. */
    const seconds = 2.5;
    const samples = new Float32Array(Math.round(16_000 * seconds));
    for (let index = 0; index < samples.length; index += 1) {
      const tone = Math.sin((2 * Math.PI * 220 * index) / 16_000);
      samples[index] = 0.04 * tone + (Math.random() * 2 - 1) * 0.01;
    }
    const finished = await Promise.race([
      this.transcribe(samples, 0, Math.round(seconds * 1000)).then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), timeoutMs),
      ),
    ]);
    if (!finished) {
      /* The worker is stuck on that window; rebuild it so the next attempt
         starts from a clean session. */
      await this.recover().catch(() => undefined);
    }
    return finished;
  }

  /**
   * Rebuilds the worker after an inference that will not come back (WebGPU can
   * stall on quiet audio). Pending transcriptions resolve as null so callers
   * are never left waiting, and the model is loaded again from cache.
   */
  async recover(): Promise<void> {
    if (this.disposed) return;
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
    this.clearStall();
    this.failLoad = null;
    this.worker.terminate();
    this.worker = this.createWorker();
    this.loadPromise = null;
    await this.load();
  }

  /** Idempotent: reuse the loaded model instead of downloading it again. */
  async load(): Promise<void> {
    if (this.disposed) throw new Error("Whisper client disposed");
    if (this.loadPromise) return this.loadPromise;
    /* Assign before the first await: probing the GPU adapter is asynchronous,
       and two callers would otherwise both start loading. */
    this.loadPromise = this.detectBackendAndLoad();
    return this.loadPromise;
  }

  private async detectBackendAndLoad(): Promise<void> {
    const backend: WhisperBackend =
      this.options.forceBackend ??
      ((await supportsWebGpu()) ? "webgpu" : "wasm");
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
    if (message.type === "timing") this.options.onTiming?.(message.ms);
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
