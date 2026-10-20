import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

function decodeEncryptionKey(encodedKey?: string): Buffer {
  if (!encodedKey) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required");
  }

  const key = Buffer.from(encodedKey, "base64");

  // Require canonical Base64 representing exactly 32 bytes.
  if (key.length !== KEY_BYTES || key.toString("base64") !== encodedKey) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be a Base64-encoded 32-byte key",
    );
  }

  return key;
}

/**
 * Format: Base64(12-byte IV || 16-byte authentication tag || ciphertext).
 * Each encryption receives a fresh random IV.
 */
export function encryptCredential(
  plaintext: string,
  encodedKey = process.env.CREDENTIAL_ENCRYPTION_KEY,
): string {
  if (typeof plaintext !== "string") {
    throw new Error("Credential must be a string");
  }

  const key = decodeEncryptionKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const payload = Buffer.concat([
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);

  return payload.toString("base64");
}

export function decryptCredential(
  encodedPayload: string,
  encodedKey = process.env.CREDENTIAL_ENCRYPTION_KEY,
): string {
  const key = decodeEncryptionKey(encodedKey);

  try {
    if (
      typeof encodedPayload !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedPayload)
    ) {
      throw new Error("Invalid payload");
    }

    const payload = Buffer.from(encodedPayload, "base64");

    if (
      payload.toString("base64") !== encodedPayload ||
      payload.length < IV_BYTES + AUTH_TAG_BYTES
    ) {
      throw new Error("Invalid payload");
    }

    const iv = payload.subarray(0, IV_BYTES);
    const authTag = payload.subarray(
      IV_BYTES,
      IV_BYTES + AUTH_TAG_BYTES,
    );
    const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Do not expose cryptographic details or credential contents.
    throw new Error("Credential decryption failed");
  }
}
