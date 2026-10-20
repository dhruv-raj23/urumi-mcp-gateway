import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "urumi_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionPayload {
  uid: string;
  exp: number;
}

function requireSessionSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }

  return secret;
}

function signPayload(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(encodedPayload, "utf8")
    .digest();
}

/** Creates a signed payload containing only the user ID and expiry. */
export function createSessionToken(
  uid: string,
  secret = process.env.SESSION_SECRET,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const signingSecret = requireSessionSecret(secret);

  if (!/^[a-f0-9]{24}$/i.test(uid)) {
    throw new Error("Invalid session user ID");
  }

  const payload: SessionPayload = {
    uid,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };

  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");

  const signature = signPayload(encodedPayload, signingSecret)
    .toString("base64url");

  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies the signature using a constant-time comparison, checks the expiry,
 * and rejects malformed tokens. Invalid cookies return null, not an error
 * containing the token or signing secret.
 */
export function verifySessionToken(
  token: string | undefined,
  secret = process.env.SESSION_SECRET,
  nowSeconds = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!token || !secret) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, encodedSignature] = parts;

  if (
    !encodedPayload ||
    !encodedSignature ||
    !/^[A-Za-z0-9_-]+$/.test(encodedPayload) ||
    !/^[A-Za-z0-9_-]+$/.test(encodedSignature)
  ) {
    return null;
  }

  try {
    const providedSignature = Buffer.from(encodedSignature, "base64url");
    const expectedSignature = signPayload(encodedPayload, secret);

    if (
      providedSignature.length !== expectedSignature.length ||
      providedSignature.toString("base64url") !== encodedSignature ||
      !timingSafeEqual(providedSignature, expectedSignature)
    ) {
      return null;
    }

    const payloadBytes = Buffer.from(encodedPayload, "base64url");
    if (payloadBytes.toString("base64url") !== encodedPayload) {
      return null;
    }

    const value: unknown = JSON.parse(payloadBytes.toString("utf8"));
    if (!value || typeof value !== "object") {
      return null;
    }

    const payload = value as Partial<SessionPayload>;

    if (
      typeof payload.uid !== "string" ||
      !/^[a-f0-9]{24}$/i.test(payload.uid) ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= nowSeconds
    ) {
      return null;
    }

    return { uid: payload.uid, exp: payload.exp };
  } catch {
    return null;
  }
}

function cookieSecurityAttribute(secure: boolean): string {
  return secure ? "; Secure" : "";
}

/** Cookie attributes are shared between set and clear operations. */
export function buildSessionCookie(
  token: string,
  secure = process.env.COOKIE_SECURE === "true",
): string {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ") + cookieSecurityAttribute(secure);
}

export function buildClearedSessionCookie(
  secure = process.env.COOKIE_SECURE === "true",
): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ") + cookieSecurityAttribute(secure);
}

/** Extract one cookie value without decoding or logging the raw Cookie header. */
export function readCookie(
  cookieHeader: string | undefined,
  cookieName = SESSION_COOKIE_NAME,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    if (name === cookieName) {
      return part.slice(separator + 1).trim();
    }
  }

  return undefined;
}
