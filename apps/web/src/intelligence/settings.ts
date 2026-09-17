/**
 * Provider/model/endpoint storage, and key handling.
 *
 * API keys are deliberately never written to localStorage in plain text:
 *
 * - A key typed into Settings lives in sessionStorage, which dies with the tab.
 * - A key the user chooses to remember is sealed in the encrypted vault
 *   (`vault.ts`) and is only readable with the vault passphrase.
 *
 * A legacy plaintext `keys` map from an earlier version is migrated into the
 * session on first load and then deleted from localStorage.
 */

import { DEFAULT_PROVIDER, getProvider, type ProviderId } from "./providers";
import type { AiConfig } from "./client";
import {
  createVault,
  eraseVault,
  isVaultUnlocked,
  lockVault,
  readVault,
  unlockVault,
  unlockedEntries,
  updateVault,
  vaultExists,
} from "./vault";

const STORAGE_KEY = "gather.ai.v1";
const SESSION_KEY = "gather.ai.session.v1";

type StoredSettings = {
  provider: ProviderId;
  /** Model per provider so switching back keeps your choice. */
  models: Partial<Record<ProviderId, string>>;
  /** Optional endpoint override per provider (proxy, gateway, Azure…). */
  baseUrls: Partial<Record<ProviderId, string>>;
  baseUrl: string;
  serverToken: string;
};

const DEFAULTS: StoredSettings = {
  provider: DEFAULT_PROVIDER,
  models: {},
  baseUrls: {},
  baseUrl: "http://127.0.0.1:8080",
  serverToken: "",
};

export type RememberState = "none" | "locked" | "unlocked";

/* ---------------------------------------------------------------------------
   Non-secret settings
   ------------------------------------------------------------------------ */

export function loadAiSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, models: {}, baseUrls: {} };
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    return {
      provider: (parsed.provider as ProviderId) ?? DEFAULTS.provider,
      models: parsed.models ?? {},
      baseUrls: parsed.baseUrls ?? {},
      baseUrl: parsed.baseUrl ?? DEFAULTS.baseUrl,
      serverToken: parsed.serverToken ?? "",
    };
  } catch {
    return { ...DEFAULTS, models: {}, baseUrls: {} };
  }
}

export function saveAiSettings(settings: StoredSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* Private browsing or a full quota: settings simply do not persist. */
  }
}

export function modelFor(
  settings: StoredSettings,
  provider: ProviderId,
): string {
  return settings.models[provider] ?? getProvider(provider).defaultModel;
}

/* ---------------------------------------------------------------------------
   Session keys
   ------------------------------------------------------------------------ */

function readSessionKeys(): Partial<Record<ProviderId, string>> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<ProviderId, string>>) : {};
  } catch {
    return {};
  }
}

function writeSessionKeys(keys: Partial<Record<ProviderId, string>>): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(keys));
  } catch {
    /* the in-memory value still works for this page view */
  }
}

export function setSessionKey(provider: ProviderId, value: string): void {
  const keys = readSessionKeys();
  const trimmed = value.trim();
  if (trimmed) keys[provider] = trimmed;
  else delete keys[provider];
  writeSessionKeys(keys);
}

/** Remove a key from this session only; the vault is untouched. */
export function clearSessionKey(provider: ProviderId): void {
  setSessionKey(provider, "");
}

/** The key to use right now: this session first, then the unlocked vault. */
export function getApiKey(provider: ProviderId): string {
  const session = readSessionKeys()[provider];
  if (session) return session;
  if (isVaultUnlocked()) return unlockedEntries()[provider] ?? "";
  return "";
}

/** Whether this session already holds a usable key for the provider. */
export function hasSessionKey(provider: ProviderId): boolean {
  return Boolean(readSessionKeys()[provider]);
}

/** Whether the unlocked vault holds a key for the provider. */
export function hasRememberedKey(provider: ProviderId): boolean {
  return Boolean(unlockedEntries()[provider]);
}

/* ---------------------------------------------------------------------------
   Vault
   ------------------------------------------------------------------------ */

export function rememberState(): RememberState {
  if (isVaultUnlocked()) return "unlocked";
  return vaultExists() ? "locked" : "none";
}

export function hasRememberedKeys(): boolean {
  return vaultExists();
}

export async function rememberApiKey(
  provider: ProviderId,
  value: string,
  passphrase: string,
): Promise<void> {
  const trimmed = value.trim();
  if (!vaultExists()) {
    await createVault(trimmed ? { [provider]: trimmed } : {}, passphrase);
    return;
  }
  await unlockVault(passphrase);
  await updateVault((entries) => {
    if (trimmed) entries[provider] = trimmed;
    else delete entries[provider];
  });
}

export async function unlockRememberedKeys(passphrase: string): Promise<void> {
  await unlockVault(passphrase);
}

export function lockRememberedKeys(): void {
  lockVault();
}

export async function forgetRememberedKey(provider: ProviderId): Promise<{
  erasedVault: boolean;
}> {
  if (!isVaultUnlocked()) {
    /* Ciphertext cannot be edited without the passphrase, so the honest option
       is to erase the whole vault. */
    if (readVault()) {
      eraseVault();
      return { erasedVault: true };
    }
    return { erasedVault: false };
  }
  const remaining = { ...unlockedEntries() };
  delete remaining[provider];
  if (Object.keys(remaining).length === 0) {
    eraseVault();
    return { erasedVault: true };
  }
  await updateVault((entries) => {
    delete entries[provider];
  });
  return { erasedVault: false };
}

/* ---------------------------------------------------------------------------
   Migration from plaintext storage
   ------------------------------------------------------------------------ */

/**
 * Move any plaintext keys written by an earlier version into this session and
 * delete them from localStorage. Returns how many were moved.
 */
export function migratePlaintextKeys(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { keys?: Record<string, string> };
    const keys = parsed.keys;
    if (!keys || typeof keys !== "object") return 0;
    const session = readSessionKeys();
    let moved = 0;
    for (const [provider, value] of Object.entries(keys)) {
      if (typeof value === "string" && value.trim()) {
        session[provider as ProviderId] = value.trim();
        moved += 1;
      }
    }
    if (moved) writeSessionKeys(session);
    delete parsed.keys;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return moved;
  } catch {
    return 0;
  }
}

export function toAiConfig(settings: StoredSettings): AiConfig {
  return {
    provider: settings.provider,
    model: modelFor(settings, settings.provider),
    apiKey: getApiKey(settings.provider),
    baseUrls: settings.baseUrls,
    baseUrl: settings.baseUrl,
    serverToken: settings.serverToken,
  };
}
