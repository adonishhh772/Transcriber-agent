import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eraseVault, lockVault } from "./vault";
import {
  clearSessionKey,
  forgetRememberedKey,
  getApiKey,
  loadAiSettings,
  migratePlaintextKeys,
  rememberApiKey,
  rememberState,
  setSessionKey,
} from "./settings";

function installStorage(): void {
  const make = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      size: () => store.size,
    };
  };
  (globalThis as { localStorage?: unknown }).localStorage = make();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = make();
}

const PASSPHRASE = "correct horse battery";

beforeEach(() => {
  installStorage();
  lockVault();
});

afterEach(() => {
  lockVault();
  eraseVault();
});

describe("session keys", () => {
  it("keeps a key for the session without touching localStorage", () => {
    setSessionKey("deepseek", "sk-session");
    expect(getApiKey("deepseek")).toBe("sk-session");
    expect(localStorage.getItem("gather.ai.v1")).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain("sk-session");
  });

  it("clears a session key on request", () => {
    setSessionKey("deepseek", "sk-session");
    clearSessionKey("deepseek");
    expect(getApiKey("deepseek")).toBe("");
  });
});

describe("remembered keys", () => {
  it("falls back to the vault once the session key is gone", async () => {
    await rememberApiKey("openai", "sk-remembered", PASSPHRASE);
    lockVault();
    expect(getApiKey("openai")).toBe("");
    expect(rememberState()).toBe("locked");

    const { unlockRememberedKeys } = await import("./settings");
    await unlockRememberedKeys(PASSPHRASE);
    expect(getApiKey("openai")).toBe("sk-remembered");
    expect(rememberState()).toBe("unlocked");
  });

  it("prefers the session key over the remembered one", async () => {
    await rememberApiKey("openai", "sk-remembered", PASSPHRASE);
    setSessionKey("openai", "sk-session");
    expect(getApiKey("openai")).toBe("sk-session");
  });

  it("erases the vault when forgetting while locked, and says so", async () => {
    await rememberApiKey("openai", "sk-remembered", PASSPHRASE);
    lockVault();
    const result = await forgetRememberedKey("openai");
    expect(result.erasedVault).toBe(true);
    expect(rememberState()).toBe("none");
  });

  it("removes only the requested provider while unlocked", async () => {
    await rememberApiKey("openai", "sk-openai", PASSPHRASE);
    const { updateVault } = await import("./vault");
    await updateVault((entries) => {
      entries.deepseek = "sk-deepseek";
    });
    const result = await forgetRememberedKey("openai");
    expect(result.erasedVault).toBe(false);
    expect(getApiKey("openai")).toBe("");
    expect(getApiKey("deepseek")).toBe("sk-deepseek");
  });
});

describe("plaintext migration", () => {
  it("moves legacy keys into the session and strips them from localStorage", () => {
    localStorage.setItem(
      "gather.ai.v1",
      JSON.stringify({
        provider: "openai",
        models: { openai: "gpt-4o-mini" },
        keys: { openai: "sk-legacy", deepseek: "sk-legacy-2" },
        baseUrl: "http://127.0.0.1:8080",
        serverToken: "",
      }),
    );

    expect(migratePlaintextKeys()).toBe(2);
    expect(getApiKey("openai")).toBe("sk-legacy");
    expect(getApiKey("deepseek")).toBe("sk-legacy-2");

    const stored = localStorage.getItem("gather.ai.v1")!;
    expect(stored).not.toContain("sk-legacy");
    expect(JSON.parse(stored).keys).toBeUndefined();
    // Unrelated settings survive the migration.
    expect(loadAiSettings().models.openai).toBe("gpt-4o-mini");
  });

  it("is a no-op when there is nothing to migrate", () => {
    expect(migratePlaintextKeys()).toBe(0);
    localStorage.setItem(
      "gather.ai.v1",
      JSON.stringify({ provider: "openai" }),
    );
    expect(migratePlaintextKeys()).toBe(0);
  });
});
