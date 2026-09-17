export type Mode = "files" | "record";

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";

export type AppState = {
  mode: Mode;
  running: boolean;
  frames: number;
  bytes: number;
  inSR: number;
  outSR: number;
  frameMs: number;
  pendingSamples: number;
  wsState: string;
  language: string;
  baseUrl: string;
  sessionId: string;
  summaryEnabled: boolean;
};

export const listeners: Array<(s: AppState) => void> = [];

export const state: AppState = {
  mode: "files",
  running: false,
  frames: 0,
  bytes: 0,
  inSR: 48000,
  outSR: 16000,
  frameMs: 20,
  pendingSamples: 0,
  wsState: "CLOSED",
  language: "en",
  baseUrl: DEFAULT_BASE_URL,
  sessionId: generateSessionId(),
  summaryEnabled: true,
};

export function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `desktop-${ts}-${rand}`;
}

export function subscribe(fn: (s: AppState) => void) {
  listeners.push(fn);
  fn(state);
}

export function patch(p: Partial<AppState>) {
  Object.assign(state, p);
  for (const l of listeners) l(state);
}

