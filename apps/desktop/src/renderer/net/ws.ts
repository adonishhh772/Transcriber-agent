import { patch } from "../ui/state";

export type WSClient = {
  open(
    hello: any,
    opts: { baseUrl: string; sessionId: string; language: string | undefined }
  ): Promise<void>;
  sendBinary(buf: ArrayBuffer): void;
  close(): void;
  onMessage?: (text: string) => void;
};

function toWebSocketUrl(baseUrl: string, sessionId: string, language: string | undefined): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(normalized);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/v1/stream/${encodeURIComponent(sessionId)}`;
  if (language && language !== "auto") {
    url.searchParams.set("lang", language);
  } else {
    url.searchParams.delete("lang");
  }
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  return url.toString();
}

export function createWS(): WSClient {
  let ws: WebSocket | null = null;
  function syncState() {
    const label = ws ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][ws.readyState] : "CLOSED";
    patch({ wsState: label });
  }

  return {
    async open(hello, opts) {
      const url = toWebSocketUrl(opts.baseUrl, opts.sessionId, opts.language);
      ws = new WebSocket(url);
      syncState();
      ws.binaryType = "arraybuffer";
      await new Promise<void>((resolve, reject) => {
        ws!.onopen = () => {
          syncState();
          ws!.send(JSON.stringify(hello));
          resolve();
        };
        ws!.onerror = () => {
          syncState();
          reject(new Error("ws_open_error"));
        };
      });
      ws.onclose = () => syncState();
      ws.onmessage = (ev) => {
        const payload = typeof ev.data === "string" ? ev.data : "[binary]";
        this.onMessage && this.onMessage(payload);
      };
    },
    sendBinary(buf) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(buf);
    },
    close() {
      try {
        ws?.close();
      } catch {}
      syncState();
    },
    onMessage: undefined,
  };
}
