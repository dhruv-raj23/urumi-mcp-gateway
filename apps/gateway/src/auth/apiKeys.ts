import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

const PREFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PREFIX_LENGTH = 8;
const SECRET_BYTES = 32;

export interface GeneratedApiKey {
  /** Full key; the caller must show it only once. */
  key: string;
  /** Non-secret lookup/display prefix. */
  prefix: string;
  /** SHA-256 hex digest to store in MongoDB. */
  hash: string;
}

export function hashApiKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("API key is required");
  }

  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  let prefix = "";

  for (let i = 0; i < PREFIX_LENGTH; i += 1) {
    prefix += PREFIX_ALPHABET[randomInt(PREFIX_ALPHABET.length)];
  }

  // 32 random bytes encode to 43 unpadded Base64URL characters.
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const key = `urumi_${prefix}_${secret}`;

  return {
    key,
    prefix,
    hash: hashApiKey(key),
  };
}

/**
 * Hash the presented key and compare fixed-size digests in constant time.
 * The caller must separately ensure the matched database key is not revoked.
 */
export function verifyApiKey(
  presentedKey: string,
  storedHash: string,
): boolean {
  if (
    typeof presentedKey !== "string" ||
    presentedKey.length === 0 ||
    typeof storedHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(storedHash)
  ) {
    return false;
  }

  const actual = createHash("sha256")
    .update(presentedKey, "utf8")
    .digest();
  const expected = Buffer.from(storedHash, "hex");

  return expected.length === actual.length &&
    timingSafeEqual(actual, expected);
}
