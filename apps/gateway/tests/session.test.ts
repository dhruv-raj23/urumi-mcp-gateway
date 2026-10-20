import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";

import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
  readCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from "../src/auth/session.js";

const TEST_SECRET = "test-session-secret-for-unit-tests";
const TEST_UID = new ObjectId().toHexString();
const FIXED_TIME = 1_800_000_000;

describe("signed stateless sessions", () => {
  it("creates and verifies an eight-hour payload", () => {
    const token = createSessionToken(TEST_UID, TEST_SECRET, FIXED_TIME);
    const payload = verifySessionToken(token, TEST_SECRET, FIXED_TIME);

    expect(payload).toEqual({
      uid: TEST_UID,
      exp: FIXED_TIME + SESSION_TTL_SECONDS,
    });
  });

  it("rejects a tampered cookie", () => {
    const token = createSessionToken(TEST_UID, TEST_SECRET, FIXED_TIME);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(verifySessionToken(tampered, TEST_SECRET, FIXED_TIME)).toBeNull();
  });

  it("rejects an expired cookie", () => {
    const token = createSessionToken(TEST_UID, TEST_SECRET, FIXED_TIME);

    expect(
      verifySessionToken(
        token,
        TEST_SECRET,
        FIXED_TIME + SESSION_TTL_SECONDS,
      ),
    ).toBeNull();
  });

  it("rejects a token signed using another secret", () => {
    const token = createSessionToken(TEST_UID, TEST_SECRET, FIXED_TIME);

    expect(
      verifySessionToken(token, "different-test-secret", FIXED_TIME),
    ).toBeNull();
  });

  it("rejects missing secrets and malformed tokens safely", () => {
    const token = createSessionToken(TEST_UID, TEST_SECRET, FIXED_TIME);

    expect(verifySessionToken(undefined, TEST_SECRET, FIXED_TIME)).toBeNull();
    expect(verifySessionToken(token, undefined, FIXED_TIME)).toBeNull();
    expect(verifySessionToken("not-a-token", TEST_SECRET, FIXED_TIME))
      .toBeNull();

    expect(() => createSessionToken(TEST_UID, undefined, FIXED_TIME))
      .toThrow("SESSION_SECRET is required");
  });

  it("sets the required cookie flags and configurable Secure attribute", () => {
    const token = createSessionToken(TEST_UID, TEST_SECRET, FIXED_TIME);
    const localCookie = buildSessionCookie(token, false);
    const productionCookie = buildSessionCookie(token, true);

    expect(localCookie).toContain(`${SESSION_COOKIE_NAME}=${token}`);
    expect(localCookie).toContain("Max-Age=28800");
    expect(localCookie).toContain("Path=/");
    expect(localCookie).toContain("HttpOnly");
    expect(localCookie).toContain("SameSite=Lax");
    expect(localCookie).not.toContain("Secure");

    expect(productionCookie).toContain("; Secure");
  });

  it("clears the cookie using matching flags", () => {
    const cookie = buildClearedSessionCookie(true);

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("; Secure");
  });

  it("reads the session cookie from a Cookie header", () => {
    const token = createSessionToken(TEST_UID, TEST_SECRET, FIXED_TIME);

    expect(
      readCookie(`theme=dark; ${SESSION_COOKIE_NAME}=${token}; other=x`),
    ).toBe(token);

    expect(readCookie("theme=dark")).toBeUndefined();
    expect(readCookie(undefined)).toBeUndefined();
  });
});
