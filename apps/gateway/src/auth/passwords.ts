import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;
const BCRYPT_MAX_BYTES = 72;

function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password is required");
  }

  // Bcrypt only uses the first 72 UTF-8 bytes.
  if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_BYTES) {
    throw new Error("Password exceeds bcrypt's 72-byte limit");
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    Buffer.byteLength(password, "utf8") > BCRYPT_MAX_BYTES ||
    typeof passwordHash !== "string" ||
    passwordHash.length === 0
  ) {
    return false;
  }

  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    // A malformed stored hash must never authenticate a user.
    return false;
  }
}
