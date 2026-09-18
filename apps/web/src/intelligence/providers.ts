/**
 * Bring-your-own-key providers.
 *
 * Verified from a real browser origin (both https and http://localhost) with an
 * invalid key: the request reached the provider, the 4xx status was readable and
 * the error body could be parsed. Keys therefore never need to touch our own
 * server.
 *
 * Caveats per provider:
 * - Anthropic rejects the preflight unless `anthropic-dangerous-direct-browser-access`
 *   is sent, so that header is mandatory on every request.
 * - Gemini takes the key in `x-goog-api-key`; keeping it out of the query string
 *   avoids leaking it into URLs and logs.
 * - OpenAI currently blocks browser POSTs: its preflight answers 200, but the
 *   POST response carries no Access-Control-Allow-Origin, so fetch rejects with
 *   "Failed to fetch" while authorised GETs succeed. This has flip-flopped
 *   before — an outage in Oct 2025 broke it and was fixed the same day, and a
 *   Jan 2026 report had Chat Completions working while /v1/responses was broken.
 *   The code path is therefore kept and the entry stays selectable: it starts
 *   working the moment OpenAI restores the header. Until then, an API base URL
 *   routes the same request through a proxy or gateway.
 * - Model identifiers change often. They are editable and suggestions only; the
 *   provider's own error message is surfaced verbatim when a name is rejected.
 */

export type ProviderId =
  | "deepseek"
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "custom"
  /**
   * Speech-to-text vendor. Not an AI-notes provider — it is absent from
   * `PROVIDERS` on purpose, and only uses the shared key storage so a Deepgram
   * key is handled exactly like the others (session memory, optional vault).
   */
  | "deepgram";

export type WireFormat = "chat-completions" | "anthropic-messages" | "gemini";

export type ProviderDefinition = {
  id: ProviderId;
  label: string;
  summary: string;
  keyLabel: string;
  keyPlaceholder: string;
  defaultModel: string;
  suggestedModels: string[];
  wire: WireFormat;
  modelLabel: string;
  requiresKey: boolean;
  /** Used when the user supplies no override. */
  defaultBaseUrl?: string;
  /** Whether an optional "API base URL" field is offered. */
  allowsBaseUrl?: boolean;
  /** Advice appended when the network layer blocks the request. */
  networkHint?: string;
};

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    summary: "Low-cost notes. The same vendor your local backend already uses.",
    keyLabel: "DeepSeek API key",
    keyPlaceholder: "sk-…",
    defaultModel: "deepseek-chat",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
    wire: "chat-completions",
    modelLabel: "DeepSeek model",
    requiresKey: true,
    defaultBaseUrl: "https://api.deepseek.com",
    allowsBaseUrl: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    summary:
      "GPT models. Direct browser calls are blocked by OpenAI — set a base URL to use a proxy, or pick OpenRouter.",
    keyLabel: "OpenAI API key",
    keyPlaceholder: "sk-…",
    defaultModel: "gpt-4o-mini",
    suggestedModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    wire: "chat-completions",
    modelLabel: "OpenAI model",
    requiresKey: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    allowsBaseUrl: true,
    networkHint:
      "OpenAI blocks direct browser requests: its preflight passes but the POST response omits the CORS header. Set an API base URL above to route through your own proxy, or use OpenRouter for GPT models.",
  },
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    summary:
      "Strong long-transcript summaries. Needs the direct-browser header.",
    keyLabel: "Anthropic API key",
    keyPlaceholder: "sk-ant-…",
    defaultModel: "claude-haiku-4-5",
    suggestedModels: ["claude-haiku-4-5", "claude-sonnet-4-5"],
    wire: "anthropic-messages",
    modelLabel: "Claude model",
    requiresKey: true,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    summary: "Has a generous free tier on several models.",
    keyLabel: "Google AI Studio key",
    keyPlaceholder: "AIza…",
    defaultModel: "gemini-2.5-flash",
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-pro"],
    wire: "gemini",
    modelLabel: "Gemini model",
    requiresKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    summary: "One key for many vendors, including GPT and Claude models.",
    keyLabel: "OpenRouter API key",
    keyPlaceholder: "sk-or-…",
    defaultModel: "openai/gpt-4o-mini",
    suggestedModels: [
      "openai/gpt-4o-mini",
      "anthropic/claude-haiku-4.5",
      "google/gemini-2.5-flash",
    ],
    wire: "chat-completions",
    modelLabel: "OpenRouter model",
    requiresKey: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    allowsBaseUrl: true,
  },
  {
    id: "custom",
    label: "Custom server",
    summary:
      "Your own endpoint or proxy, e.g. this repo's FastAPI service on 127.0.0.1:8080.",
    keyLabel: "Bearer token",
    keyPlaceholder: "Only if your server requires one",
    defaultModel: "",
    suggestedModels: [],
    wire: "chat-completions",
    modelLabel: "Model",
    requiresKey: false,
  },
];

export const DEFAULT_PROVIDER: ProviderId = "deepseek";

export function getProvider(id: string | undefined): ProviderDefinition {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
}
