import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  decryptCredential,
  encryptCredential,
} from "../src/crypto/credentials.js";
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
} from "../src/auth/apiKeys.js";
import {
  hashPassword,
  verifyPassword,
} from "../src/auth/passwords.js";

describe("credential encryption", () => {
  it("round-trips a credential", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptCredential("upstream-secret", key);

    expect(encrypted).not.toContain("upstream-secret");
    expect(decryptCredential(encrypted, key)).toBe("upstream-secret");
  });

  it("uses a fresh IV for each encryption", () => {
    const key = randomBytes(32).toString("base64");

    const first = encryptCredential("same-secret", key);
    const second = encryptCredential("same-secret", key);

    expect(first).not.toBe(second);
    expect(decryptCredential(first, key)).toBe("same-secret");
    expect(decryptCredential(second, key)).toBe("same-secret");
  });

  it("rejects an invalid key and a wrong decryption key", () => {
    const key = randomBytes(32).toString("base64");
    const otherKey = randomBytes(32).toString("base64");
    const encrypted = encryptCredential("secret", key);

    expect(() => encryptCredential("secret", "invalid")).toThrow(
      "CREDENTIAL_ENCRYPTION_KEY must be a Base64-encoded 32-byte key",
    );
    expect(() => decryptCredential(encrypted, otherKey)).toThrow(
      "Credential decryption failed",
    );
  });
});

describe("password hashing", () => {
  it("hashes asynchronously and verifies the password", async () => {
    const hash = await hashPassword("test-password-for-unit-test");

    expect(hash).not.toBe("test-password-for-unit-test");
    expect(hash.startsWith("$2")).toBe(true);
    await expect(
      verifyPassword("test-password-for-unit-test", hash),
    ).resolves.toBe(true);
    await expect(verifyPassword("incorrect-password", hash)).resolves.toBe(
      false,
    );
  }, 10000);

  it("rejects passwords that bcrypt would truncate", async () => {
    await expect(hashPassword("x".repeat(73))).rejects.toThrow(
      "Password exceeds bcrypt's 72-byte limit",
    );
  });

  it("fails safely for malformed password hashes", async () => {
    await expect(verifyPassword("some-password", "not-a-bcrypt-hash"))
      .resolves.toBe(false);
  });
});

describe("API keys", () => {
  it("generates the required format and stores only a hash", () => {
    const result = generateApiKey();
    const match = /^urumi_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/.exec(
      result.key,
    );

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(result.prefix);
    expect(result.prefix).toMatch(/^[a-z0-9]{8}$/);
    expect(match?.[2]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.hash).not.toBe(result.key);
  });

  it("verifies the full key against its SHA-256 hash", () => {
    const { key, hash } = generateApiKey();

    expect(hashApiKey(key)).toBe(hash);
    expect(verifyApiKey(key, hash)).toBe(true);
    expect(verifyApiKey("urumi_wrong_wrong", hash)).toBe(false);
    expect(verifyApiKey(key, "malformed-hash")).toBe(false);
  });
});
