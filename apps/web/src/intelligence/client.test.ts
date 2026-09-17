import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeConfiguration,
  endpointFor,
  isConfigured,
  requestNotes,
  type AiConfig,
} from "./client";
import { getProvider } from "./providers";

/**
 * The client calls `window.setTimeout`, which does not exist in the node test
 * environment. A tiny shim keeps the tests dependency-free.
 */
beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: "sk-test",
    baseUrls: {},
    baseUrl: "",
    serverToken: "",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const NOTES = {
  executiveSummary: "We narrowed scope.",
  keyPoints: ["Scope frozen"],
};

describe("isConfigured", () => {
  it("requires a key for keyed providers", () => {
    expect(isConfigured(config())).toBe(true);
    expect(isConfigured(config({ apiKey: "  " }))).toBe(false);
  });

  it("requires a URL for the custom provider", () => {
    expect(isConfigured(config({ provider: "custom", apiKey: "" }))).toBe(
      false,
    );
    expect(
      isConfigured(
        config({ provider: "custom", apiKey: "", baseUrl: "http://x:1" }),
      ),
    ).toBe(true);
  });
});

describe("describeConfiguration", () => {
  it("names the provider and model", () => {
    expect(describeConfiguration(config())).toBe("DeepSeek · deepseek-chat");
  });

  it("explains what is missing", () => {
    expect(describeConfiguration(config({ apiKey: "" }))).toMatch(
      /API key missing/,
    );
  });
});

describe("endpointFor", () => {
  const provider = getProvider("openai");

  it("falls back to the provider default", () => {
    expect(endpointFor(provider, config({ provider: "openai" }))).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("accepts a bare host, a host with /v1, and a full path", () => {
    const withBase = (base: string) =>
      endpointFor(
        provider,
        config({ provider: "openai", baseUrls: { openai: base } }),
      );
    expect(withBase("https://proxy.example.com")).toBe(
      "https://proxy.example.com/chat/completions",
    );
    expect(withBase("https://proxy.example.com/v1/")).toBe(
      "https://proxy.example.com/v1/chat/completions",
    );
    expect(withBase("https://gw.example.com/v1/chat/completions")).toBe(
      "https://gw.example.com/v1/chat/completions",
    );
    // Azure-style paths must be used verbatim.
    expect(
      withBase(
        "https://x.openai.azure.com/openai/deployments/d/chat/completions",
      ),
    ).toBe("https://x.openai.azure.com/openai/deployments/d/chat/completions");
  });
});

describe("OpenAI", () => {
  it("is offered and can be called once a base URL works", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: JSON.stringify(NOTES) } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestNotes(
      config({ provider: "openai", model: "gpt-4o-mini" }),
      { transcript: "text", sessionId: "s1", final: true },
    );

    expect(result.executiveSummary).toBe("We narrowed scope.");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body).response_format).toEqual({
      type: "json_object",
    });
  });

  it("explains OpenAI's browser block instead of a generic network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    const failure = (await requestNotes(
      config({ provider: "openai", model: "gpt-4o-mini" }),
      { transcript: "text", sessionId: "s1", final: true },
    ).catch((error: unknown) => error)) as Error;

    expect(failure.message).toMatch(/OpenAI blocks direct browser requests/);
    expect(failure.message).toMatch(/API base URL/);
    expect(failure.message).not.toMatch(/Check your connection/);
  });
});

describe("requestNotes wire formats", () => {
  it("calls OpenAI-compatible providers with a bearer token and JSON mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: JSON.stringify(NOTES) } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestNotes(config(), {
      transcript: "We narrowed scope.",
      sessionId: "s1",
      final: true,
    });

    expect(result.executiveSummary).toBe("We narrowed scope.");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body).response_format).toEqual({
      type: "json_object",
    });
  });

  it("routes Gemini to generateContent with the key in a header, never the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: JSON.stringify(NOTES) }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestNotes(
      config({
        provider: "gemini",
        model: "gemini-2.5-flash",
        apiKey: "AIza-x",
      }),
      { transcript: "text", sessionId: "s1", final: false },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/models/gemini-2.5-flash:generateContent");
    expect(url).not.toContain("AIza-x");
    expect(init.headers["x-goog-api-key"]).toBe("AIza-x");
    expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe(
      "application/json",
    );
  });

  it("sends Anthropic the direct-browser-access header and a max token budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ type: "text", text: JSON.stringify(NOTES) }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestNotes(
      config({ provider: "anthropic", model: "claude-haiku-4-5" }),
      { transcript: "text", sessionId: "s1", final: true },
    );

    expect(result.keyPoints).toEqual(["Scope frozen"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe(
      "true",
    );
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    expect(JSON.parse(init.body).max_tokens).toBeGreaterThan(0);
  });

  it("posts the FastAPI payload shape to a custom server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTES));
    vi.stubGlobal("fetch", fetchMock);

    await requestNotes(
      config({
        provider: "custom",
        apiKey: "",
        baseUrl: "http://127.0.0.1:8080",
      }),
      { transcript: "joined text", sessionId: "sess-1", final: true },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8080/v1/intelligence/rolling");
    expect(JSON.parse(init.body)).toMatchObject({
      session_id: "sess-1",
      transcript: "joined text",
      final: true,
    });
  });
});

describe("error messages", () => {
  it("explains a bad key", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: "Invalid API key" } }, 401),
        ),
    );
    await expect(
      requestNotes(config(), { transcript: "t", sessionId: "s", final: true }),
    ).rejects.toThrow(/rejected the API key.*Invalid API key/s);
  });

  it("explains rate limiting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 429)));
    await expect(
      requestNotes(config(), { transcript: "t", sessionId: "s", final: true }),
    ).rejects.toThrow(/rate limiting/);
  });

  it("explains an unknown model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    await expect(
      requestNotes(config(), { transcript: "t", sessionId: "s", final: true }),
    ).rejects.toThrow(/does not recognise that model name/);
  });

  it("turns a network failure into a recovery action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(
      requestNotes(config(), { transcript: "t", sessionId: "s", final: true }),
    ).rejects.toThrow(/Could not reach DeepSeek/);
  });

  it("refuses to call a provider without a key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      requestNotes(config({ apiKey: "" }), {
        transcript: "t",
        sessionId: "s",
        final: true,
      }),
    ).rejects.toThrow(/Add your DeepSeek API key in Settings/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to summarise an empty transcript", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      requestNotes(config(), { transcript: "  ", sessionId: "s", final: true }),
    ).rejects.toThrow(/no transcript/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
