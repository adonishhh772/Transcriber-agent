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

export class WhisperClient {
  private readonly worker: Worker;
  private readonly options: WhisperClientOptions;
  private nextId = 1;
  private pending = new Map<
    number,
    (segment: TranscriptSegment | null) => void
  >();
  private loadPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(options: WhisperClientOptions) {
    this.options = options;
    this.worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<WhisperWorkerResponse>) =>
      this.handleMessage(event.data);
    this.worker.onerror = (event) =>
      this.options.onError?.(event.message || "Whisper worker error");
  }

  async load(): Promise<void> {
    if (this.disposed) throw new Error("Whisper client disposed");
    if (this.loadPromise) return this.loadPromise;
    let backend: WhisperBackend = (await supportsWebGpu()) ? "webgpu" : "wasm";
    this.options.onBackend?.(backend);
    this.loadPromise = new Promise<void>((resolve, reject) => {
      const listener = (event: MessageEvent<WhisperWorkerResponse>) => {
        if (event.data.type === "loaded") {
          this.worker.removeEventListener("message", listener);
          resolve();
        } else if (event.data.type === "error") {
          this.worker.removeEventListener("message", listener);
          if (backend === "webgpu") {
            backend = "wasm";
            this.options.onBackend?.("wasm");
            const retryListener = (
              retry: MessageEvent<WhisperWorkerResponse>,
            ) => {
              if (retry.data.type === "loaded") {
                this.worker.removeEventListener("message", retryListener);
                resolve();
              } else if (retry.data.type === "error") {
                this.worker.removeEventListener("message", retryListener);
                reject(new Error(retry.data.message));
              }
            };
            this.worker.addEventListener("message", retryListener);
            this.worker.postMessage({
              type: "load",
              model: this.options.model,
              backend,
            } satisfies WhisperWorkerRequest);
            return;
          }
          reject(new Error(event.data.message));
        }
      };
      this.worker.addEventListener("message", listener);
      this.worker.postMessage({
        type: "load",
        model: this.options.model,
        backend,
      } satisfies WhisperWorkerRequest);
    });
    return this.loadPromise;
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
