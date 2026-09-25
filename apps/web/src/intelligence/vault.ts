/**
 * Passphrase-protected vault.
 *
 * Remembered API keys and saved meetings are sealed with AES-256-GCM under a
 * key derived from the user's passphrase with PBKDF2-HMAC-SHA256. Only the
 * ciphertext, salt and IV are persisted; the passphrase itself is never stored,
 * so the vault can only be opened by someone who knows it. Keys live in
 * localStorage. Meetings are too large for that, so their ciphertext lives in
 * IndexedDB, encrypted with this same key.
 *
 * What this protects against: another person using this browser profile, a
 * synced or backed-up copy of localStorage, casual inspection in DevTools, and a
 * stolen disk.
 *
 * What it does not protect against: code running in this page while the vault is
 * unlocked. Decrypting yields the key in memory, because the provider request
 * needs it, so XSS or an extension with page access can read it either way.
 */

export type VaultBlob = {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
};

export type VaultSession = {
  key: CryptoKey;
  salt: string;
  iterations: number;
  entries: Record<string, string>;
};

const VAULT_STORAGE_KEY = "gather.ai.vault.v1";
/** OWASP guidance for PBKDF2-HMAC-SHA256; stored per blob so it can be raised. */
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
export const MIN_PASSPHRASE_LENGTH = 8;

export type SealedPayload = {
  iv: string;
  data: string;
};

/** Thrown when a meeting is read or written before the vault is unlocked. */
export class VaultLockedError extends Error {
  constructor() {
    super("Unlock the vault before reading or saving meetings.");
    this.name = "VaultLockedError";
  }
}

let session: VaultSession | null = null;

function requireSession(): VaultSession {
  if (!session) throw new VaultLockedError();
  return session;
}

export function encryptionAvailable(): boolean {
  return Boolean(
    typeof crypto !== "undefined" &&
    crypto.subtle &&
    typeof crypto.subtle.encrypt === "function",
  );
}

function toBase64(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ---------------------------------------------------------------------------
   Blob storage
   ------------------------------------------------------------------------ */

export function readVault(): VaultBlob | null {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultBlob;
    if (
      parsed?.v !== 1 ||
      typeof parsed.salt !== "string" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.data !== "string"
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeVault(blob: VaultBlob | null): void {
  try {
    if (blob) localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(blob));
    else localStorage.removeItem(VAULT_STORAGE_KEY);
  } catch {
    /* storage may be unavailable; the vault simply does not persist */
  }
}

export function vaultExists(): boolean {
  return readVault() !== null;
}

export function isVaultUnlocked(): boolean {
  return session !== null;
}

export function unlockedEntries(): Record<string, string> {
  return session ? { ...session.entries } : {};
}

export function lockVault(): void {
  session = null;
}

export function eraseVault(): void {
  session = null;
  writeVault(null);
}

/* ---------------------------------------------------------------------------
   Create / unlock / update
   ------------------------------------------------------------------------ */

async function seal(
  entries: Record<string, string>,
  key: CryptoKey,
  salt: string,
  iterations: number,
): Promise<VaultBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(entries)),
  );
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt,
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

/** Create a brand new vault holding `entries`, protected by `passphrase`. */
export async function createVault(
  entries: Record<string, string>,
  passphrase: string,
): Promise<void> {
  if (!encryptionAvailable())
    throw new Error(
      "Encryption needs HTTPS or localhost, so the key cannot be remembered here.",
    );
  if (passphrase.length < MIN_PASSPHRASE_LENGTH)
    throw new Error(
      `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`,
    );
  const salt = crypto.getRandomValues(
    new Uint8Array(new ArrayBuffer(SALT_BYTES)),
  );
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const blob = await seal(entries, key, toBase64(salt), ITERATIONS);
  writeVault(blob);
  session = {
    key,
    salt: blob.salt,
    iterations: blob.iterations,
    entries: { ...entries },
  };
}

/** Open an existing vault. Throws when the passphrase is wrong. */
export async function unlockVault(
  passphrase: string,
): Promise<Record<string, string>> {
  const blob = readVault();
  if (!blob) throw new Error("There is no saved vault on this device.");
  if (!encryptionAvailable())
    throw new Error("Encryption needs HTTPS or localhost to unlock the vault.");
  const salt = fromBase64(blob.salt);
  const key = await deriveKey(passphrase, salt, blob.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(blob.iv) },
      key,
      fromBase64(blob.data),
    );
  } catch {
    throw new Error("That passphrase did not unlock the vault.");
  }
  let entries: Record<string, string> = {};
  try {
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    if (parsed && typeof parsed === "object")
      entries = parsed as Record<string, string>;
  } catch {
    throw new Error("The saved vault could not be read.");
  }
  session = { key, salt: blob.salt, iterations: blob.iterations, entries };
  return { ...entries };
}

/**
 * Seal an arbitrary payload with the unlocked vault key.
 * A fresh IV is used every time, so two identical payloads do not match.
 */
export async function sealText(plaintext: string): Promise<SealedPayload> {
  const current = requireSession();
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    current.key,
    new TextEncoder().encode(plaintext),
  );
  return {
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

/** Open a payload sealed by `sealText`. Throws when the vault is locked or the bytes were tampered with. */
export async function openText(payload: SealedPayload): Promise<string> {
  const current = requireSession();
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(payload.iv) },
      current.key,
      fromBase64(payload.data),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof VaultLockedError) throw error;
    throw new Error("The saved vault could not be read.");
  }
}

/** Seal raw bytes (meeting audio) with the unlocked vault key. */
export async function sealBytes(
  plaintext: ArrayBuffer,
): Promise<{ iv: string; ciphertext: ArrayBuffer }> {
  const current = requireSession();
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    current.key,
    plaintext,
  );
  return { iv: toBase64(iv), ciphertext };
}

/** Open bytes sealed by `sealBytes`. */
export async function openBytes(
  iv: string,
  ciphertext: ArrayBuffer,
): Promise<ArrayBuffer> {
  const current = requireSession();
  try {
    return await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) },
      current.key,
      ciphertext,
    );
  } catch (error) {
    if (error instanceof VaultLockedError) throw error;
    throw new Error("The saved vault could not be read.");
  }
}

/** Re-encrypt the unlocked vault after changing its contents. */
export async function updateVault(
  mutate: (entries: Record<string, string>) => void,
): Promise<void> {
  if (!session)
    throw new Error("Unlock the vault before changing what it remembers.");
  const entries = { ...session.entries };
  mutate(entries);
  const blob = await seal(
    entries,
    session.key,
    session.salt,
    session.iterations,
  );
  writeVault(blob);
  session.entries = entries;
}
