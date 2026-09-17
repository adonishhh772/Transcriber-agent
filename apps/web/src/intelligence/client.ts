/**
 * Direct browser calls to model providers.
 *
 * Each function sends the same prompt and returns normalised notes. Errors are
 * translated into plain language with a recovery action, because a raw
 * "Failed to fetch" is useless to a user in a meeting.
 */

import {
  buildPrompt,
  normalizeResult,
  parseJsonLoose,
  SYSTEM_PROMPT,
  type IntelligenceResult,
} from "./notes";
import {
  getProvider,
  type ProviderDefinition,
  type ProviderId,
} from "./providers";

export type AiConfig = {
  provider: ProviderId;
  model: string;
  apiKey: string;
  /** Optional per-provider endpoint override (proxy, gateway, Azure…). */
  baseUrls: Partial<Record<ProviderId, string>>;
  /** Custom provider only. */
  baseUrl: string;
  /** Custom provider only. */
  serverToken: string;
};

export type AiRequest = {
  transcript: string;
  sessionId: string;
  final: boolean;
};

const REQUEST_TIMEOUT_MS = 45_000;

const ENDPOINTS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

const GEMINI_BASE: string =
  "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Resolve the endpoint for a chat-completions provider.
 *
 * An override may be a bare host, a host plus `/v1`, or the full completion
 * path (Azure and some gateways need the last form), so anything already ending
 * in a known path segment is used verbatim.
 */
export function endpointFor(
  provider: ProviderDefinition,
  config: AiConfig,
): string {
  const override = (config.baseUrls?.[provider.id] ?? "").trim();
  const base = override || provider.defaultBaseUrl || ENDPOINTS[provider.id];
  const trimmed = base.replace(/\/+$/, "");
  if (/\/(chat\/completions|completions|responses)$/.test(trimmed))
    return trimmed;
  return `${trimmed}/chat/completions`;
}

export function isConfigured(config: AiConfig): boolean {
  const provider = getProvider(config.provider);
  if (provider.requiresKey && !config.apiKey.trim()) return false;
  if (provider.id === "custom") return Boolean(config.baseUrl.trim());
  return Boolean(config.model.trim());
}

export function describeConfiguration(config: AiConfig): string {
  const provider = getProvider(config.provider);
  if (provider.id === "custom")
    return config.baseUrl.trim() || "No server URL set";
  if (provider.requiresKey && !config.apiKey.trim())
    return `${provider.label}: API key missing`;
  if (!config.model.trim()) return `${provider.label}: model missing`;
  return `${provider.label} · ${config.model.trim()}`;
}

export async function requestNotes(
  config: AiConfig,
  request: AiRequest,
): Promise<IntelligenceResult> {
  if (!request.transcript.trim())
    throw new Error("There is no transcript to summarise yet.");
  const provider = getProvider(config.provider);
  if (provider.requiresKey && !config.apiKey.trim())
    throw new Error(
      `Add your ${provider.label} API key in Settings to generate AI notes.`,
    );

  const text =
    provider.id === "custom"
      ? await callCustomServer(config, request)
      : await callProvider(provider, config, request);
  return normalizeResult(parseJsonLoose(text));
}

/* ---------------------------------------------------------------------------
   Wire formats
   ------------------------------------------------------------------------ */

async function callProvider(
  provider: ProviderDefinition,
  config: AiConfig,
  request: AiRequest,
): Promise<string> {
  const prompt = buildPrompt(request.transcript, request.final);
  if (provider.wire === "anthropic-messages")
    return callAnthropic(config, prompt);
  if (provider.wire === "gemini") return callGemini(config, prompt);
  return callChatCompletions(provider, config, prompt);
}

async function callChatCompletions(
  provider: ProviderDefinition,
  config: AiConfig,
  prompt: string,
): Promise<string> {
  const response = await postJson(
    endpointFor(provider, config),
    {
      model: config.model.trim() || provider.defaultModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    },
    { Authorization: `Bearer ${config.apiKey.trim()}` },
    provider.label,
    provider.networkHint,
  );
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    error?: { message?: string };
  };
  const content = data.choices?.[0]?.message?.content;
  return contentToString(content);
}

async function callAnthropic(
  config: AiConfig,
  prompt: string,
): Promise<string> {
  // Anthropic blocks browser calls unless this header is present. It is also
  // part of the preflight allow-list, so it must be sent on every request.
  const response = await postJson(
    ENDPOINTS.anthropic,
    {
      model: config.model.trim() || "claude-haiku-4-5",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    },
    {
      "x-api-key": config.apiKey.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    "Claude",
  );
  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: unknown }>;
  };
  const block = data.content?.find((item) => item.type === "text");
  return contentToString(block?.text);
}

async function callGemini(config: AiConfig, prompt: string): Promise<string> {
  const model = (config.model.trim() || "gemini-2.5-flash").replace(
    /^models\//,
    "",
  );
  const response = await postJson(
    `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`,
    {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    },
    // Header rather than ?key= so the secret never lands in a URL or log.
    { "x-goog-api-key": config.apiKey.trim() },
    "Gemini",
  );
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => contentToString(part.text)).join("");
}

/** The existing FastAPI service, kept for local and self-hosted use. */
async function callCustomServer(
  config: AiConfig,
  request: AiRequest,
): Promise<string> {
  const base = config.baseUrl.trim();
  if (!base) throw new Error("Add your server URL in Settings first.");
  let url: URL;
  try {
    url = new URL("/v1/intelligence/rolling", base);
  } catch {
    throw new Error("That server URL is not a valid address.");
  }
  const response = await postJson(
    url.toString(),
    {
      session_id: request.sessionId,
      transcript: request.transcript,
      segments: [],
      final: request.final,
    },
    config.serverToken.trim()
      ? { Authorization: `Bearer ${config.serverToken.trim()}` }
      : {},
    "Your notes server",
  );
  // The backend already answers with the final JSON shape.
  return JSON.stringify(await response.json());
}

/* ---------------------------------------------------------------------------
   Shared plumbing
   ------------------------------------------------------------------------ */

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  label: string,
  networkHint?: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(
        `${label} did not answer within 45 seconds. Local transcription continues.`,
      );
    /* A TypeError here is the browser refusing the response (CORS) or the
       network being unreachable; providers can explain their own case. */
    throw new Error(
      networkHint
        ? `${networkHint} Your transcript is safe locally.`
        : `Could not reach ${label}. Check your connection, VPN or ad blocker. Your transcript is safe locally.`,
    );
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(await describeHttpError(response, label));
  return response;
}

async function describeHttpError(
  response: Response,
  label: string,
): Promise<string> {
  const detail = await readErrorDetail(response);
  const suffix = detail ? ` ${detail}` : "";
  if (response.status === 401 || response.status === 403)
    return `${label} rejected the API key. Check it in Settings.${suffix}`;
  if (response.status === 402)
    return `${label} reports an unpaid balance. Add credit or switch provider.${suffix}`;
  if (response.status === 404)
    return `${label} does not recognise that model name. Update it in Settings.${suffix}`;
  if (response.status === 429)
    return `${label} is rate limiting this key. Wait a moment and retry.${suffix}`;
  if (response.status === 400) return `${label} rejected the request.${suffix}`;
  if (response.status === 503)
    return `${label} is temporarily unavailable. Retry shortly.${suffix}`;
  return `${label} returned an error (${response.status}).${suffix}`;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown } | string;
      message?: unknown;
      detail?: unknown;
    };
    const candidate =
      (typeof body.error === "object" && body.error?.message) ||
      (typeof body.error === "string" && body.error) ||
      body.message ||
      body.detail;
    const text = typeof candidate === "string" ? candidate.trim() : "";
    return text ? text.slice(0, 200) : "";
  } catch {
    return "";
  }
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof (part as { text?: unknown })?.text === "string"
            ? ((part as { text: string }).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

/** Minimal round-trip used by the "Test connection" action. */
export async function testConnection(config: AiConfig): Promise<string> {
  const result = await requestNotes(config, {
    transcript:
      "Minutes check: we agreed to keep this meeting short and to ship the notes screen.",
    sessionId: "connection-test",
    final: false,
  });
  if (!result.executiveSummary && result.keyPoints.length === 0)
    return "Connected, but the reply contained no notes.";
  return "Connection works — the model returned notes.";
}
