import type { Collection } from "mongodb";
import bcrypt from "bcryptjs";

import type { UserDocument, UserRole } from "../db/models.js";
import { verifyPassword } from "./passwords.js";

// One process-local dummy hash reduces account-enumeration timing differences.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  "urumi-nonexistent-account-dummy-password",
  12,
);

export interface AuthenticatedPrincipal {
  id: string;
  email: string;
  role: UserRole;
}

/**
 * Validates login credentials. Only active users can authenticate.
 * The returned object deliberately excludes passwordHash and inviteTokenHash.
 *
 * The HTTP layer should return the same generic error for an unknown email,
 * incorrect password, invited user, or disabled user.
 */
export async function authenticateUser(
  users: Collection<UserDocument>,
  emailValue: string,
  password: string,
): Promise<AuthenticatedPrincipal | null> {
  if (
    typeof emailValue !== "string" ||
    typeof password !== "string" ||
    !emailValue.trim() ||
    !password
  ) {
    return null;
  }

  const email = emailValue.trim().toLowerCase();
  const user = await users.findOne({ email });

  if (!user) {
    // Use bcrypt even when no account exists. HTTP returns the same 401
    // response for both unknown emails and incorrect passwords.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }

  // Verify the password before checking status so that the response does
  // not reveal whether a known account is active or disabled.
  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches || user.status !== "active") {
    return null;
  }

  return {
    id: user._id.toHexString(),
    email: user.email,
    role: user.role,
  };
}
