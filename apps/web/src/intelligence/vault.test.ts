import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MIN_PASSPHRASE_LENGTH,
  createVault,
  encryptionAvailable,
  eraseVault,
  isVaultUnlocked,
  lockVault,
  readVault,
  openText,
  sealText,
  unlockVault,
  unlockedEntries,
  updateVault,
  vaultExists,
  VaultLockedError,
} from "./vault";

/** Minimal in-memory localStorage for the node test environment. */
function installStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
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

describe("encryption availability", () => {
  it("finds Web Crypto in this environment", () => {
    expect(encryptionAvailable()).toBe(true);
  });
});

describe("vault lifecycle", () => {
  it("seals keys and reads them back with the passphrase", async () => {
    await createVault({ deepseek: "sk-secret-value" }, PASSPHRASE);
    expect(vaultExists()).toBe(true);
    expect(isVaultUnlocked()).toBe(true);

    const raw = readVault();
    expect(raw).not.toBeNull();
    // The plaintext must not appear anywhere in the stored blob.
    expect(JSON.stringify(raw)).not.toContain("sk-secret-value");
    expect(raw?.kdf).toBe("PBKDF2-SHA256");
    expect(raw?.iterations).toBeGreaterThan(100_000);

    lockVault();
    expect(isVaultUnlocked()).toBe(false);
    expect(unlockedEntries()).toEqual({});

    const entries = await unlockVault(PASSPHRASE);
    expect(entries).toEqual({ deepseek: "sk-secret-value" });
    expect(isVaultUnlocked()).toBe(true);
  });

  it("refuses the wrong passphrase and stays locked", async () => {
    await createVault({ openai: "sk-openai" }, PASSPHRASE);
    lockVault();
    await expect(unlockVault("wrong passphrase")).rejects.toThrow(
      /did not unlock the vault/,
    );
    expect(isVaultUnlocked()).toBe(false);
  });

  it("rejects a short passphrase when creating a vault", async () => {
    await expect(createVault({ openai: "sk-openai" }, "short")).rejects.toThrow(
      new RegExp(`at least ${MIN_PASSPHRASE_LENGTH}`),
    );
    expect(vaultExists()).toBe(false);
  });

  it("updates entries without re-entering the passphrase, then still needs it after locking", async () => {
    await createVault({ deepseek: "sk-one" }, PASSPHRASE);
    await updateVault((entries) => {
      entries.openai = "sk-two";
    });
    lockVault();
    expect(await unlockVault(PASSPHRASE)).toEqual({
      deepseek: "sk-one",
      openai: "sk-two",
    });
  });

  it("refuses to update while locked", async () => {
    await createVault({ deepseek: "sk-one" }, PASSPHRASE);
    lockVault();
    await expect(updateVault(() => undefined)).rejects.toThrow(
      /Unlock the vault/,
    );
  });

  it("detects a tampered ciphertext", async () => {
    await createVault({ deepseek: "sk-one" }, PASSPHRASE);
    const blob = readVault()!;
    // Flip a character in the ciphertext and write it back.
    const flipped =
      blob.data.slice(0, -2) + (blob.data.endsWith("A") ? "B" : "A") + "=";
    localStorage.setItem(
      "gather.ai.vault.v1",
      JSON.stringify({ ...blob, data: flipped }),
    );
    lockVault();
    await expect(unlockVault(PASSPHRASE)).rejects.toThrow(
      /did not unlock the vault/,
    );
  });

  it("uses a fresh salt and IV for every vault so ciphertexts differ", async () => {
    await createVault({ deepseek: "same-key" }, PASSPHRASE);
    const first = readVault()!;
    eraseVault();
    await createVault({ deepseek: "same-key" }, PASSPHRASE);
    const second = readVault()!;
    expect(second.salt).not.toBe(first.salt);
    expect(second.iv).not.toBe(first.iv);
    expect(second.data).not.toBe(first.data);
  });

  it("seals an extra payload with the unlocked key and refuses it while locked", async () => {
    await createVault({}, PASSPHRASE);
    const sealed = await sealText("quarterly-planning-notes");
    expect(sealed.data).not.toContain("quarterly-planning-notes");
    expect(await openText(sealed)).toBe("quarterly-planning-notes");
    lockVault();
    await expect(sealText("another")).rejects.toBeInstanceOf(VaultLockedError);
    await expect(openText(sealed)).rejects.toBeInstanceOf(VaultLockedError);
  });

  it("forgets everything on erase", async () => {
    await createVault({ deepseek: "sk-one" }, PASSPHRASE);
    eraseVault();
    expect(vaultExists()).toBe(false);
    expect(isVaultUnlocked()).toBe(false);
  });
});
