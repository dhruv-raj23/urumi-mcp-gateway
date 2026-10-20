import { createHash, randomBytes } from "node:crypto";
import { ObjectId, type Collection } from "mongodb";

import type { UserDocument, UserRole } from "../db/models.js";
import { hashPassword } from "./passwords.js";

/** Invitation links are valid for 24 hours from issue/re-issue. */
export const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
export const INVITATION_TOKEN_BYTES = 32;

export interface IssuedInvitation {
  id: string;
  email: string;
  role: UserRole;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  reissued: boolean;
}

export type IssueInvitationResult =
  | { kind: "issued"; invitation: IssuedInvitation }
  | { kind: "reissued"; invitation: IssuedInvitation }
  | { kind: "active-conflict" }
  | { kind: "state-conflict" };

export interface AcceptedInvitation {
  id: string;
  email: string;
  role: UserRole;
}

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function makeToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");
}

function publicInvitation(
  user: Pick<UserDocument, "_id" | "email" | "role" | "createdAt">,
  token: string,
  expiresAt: Date,
  reissued: boolean,
): IssuedInvitation {
  return {
    id: user._id.toHexString(),
    email: user.email,
    role: user.role,
    token,
    expiresAt,
    createdAt: user.createdAt,
    reissued,
  };
}

/** Issues a new invitation or rotates an existing invited user's token. */
export async function issueInvitation(
  users: Collection<UserDocument>,
  emailValue: string,
  role: UserRole,
  nowProvider: () => Date = () => new Date(),
): Promise<IssueInvitationResult> {
  const email = emailValue.trim().toLowerCase();
  const now = nowProvider();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const token = makeToken();
  const tokenHash = hashInvitationToken(token);
  const existing = await users.findOne({ email });

  if (existing) {
    if (existing.status === "active") {
      return { kind: "active-conflict" };
    }

    // Decision: disabled users require explicit reactivation before invitation.
    // Re-invitation here is only allowed for accounts still in invited status.
    if (existing.status !== "invited") {
      return { kind: "state-conflict" };
    }

    const result = await users.updateOne(
      { _id: existing._id, status: "invited" },
      { $set: { role, inviteTokenHash: tokenHash, inviteExpiresAt: expiresAt } },
    );

    if (result.modifiedCount !== 1) {
      return { kind: "state-conflict" };
    }

    return {
      kind: "reissued",
      invitation: publicInvitation({ ...existing, role }, token, expiresAt, true),
    };
  }

  // Invited users need a valid password hash in the schema before acceptance.
  // Hash an independent random value that the user never receives; acceptance
  // atomically replaces this value with the chosen password hash.
  const unusablePassword = randomBytes(32).toString("base64url");
  const passwordHash = await hashPassword(unusablePassword);
  const document: UserDocument = {
    _id: new ObjectId(),
    email,
    passwordHash,
    role,
    status: "invited",
    inviteTokenHash: tokenHash,
    inviteExpiresAt: expiresAt,
    createdAt: now,
  };

  try {
    await users.insertOne(document);
  } catch (error) {
    // The unique email index closes the race between simultaneous invitations.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000
    ) {
      return { kind: "state-conflict" };
    }
    throw error;
  }

  return {
    kind: "issued",
    invitation: publicInvitation(document, token, expiresAt, false),
  };
}

/**
 * Accepts a token exactly once. Password policy is also enforced by the HTTP
 * schema; it is repeated here as a defense in depth for non-HTTP callers.
 */
export async function acceptInvitation(
  users: Collection<UserDocument>,
  token: string,
  password: string,
  nowProvider: () => Date = () => new Date(),
): Promise<AcceptedInvitation | null> {
  if (Array.from(password).length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    return null;
  }

  const tokenHash = hashInvitationToken(token);
  const lookupNow = nowProvider();
  const user = await users.findOne({ inviteTokenHash: tokenHash });

  if (
    !user ||
    user.status !== "invited" ||
    !user.inviteExpiresAt ||
    user.inviteExpiresAt.getTime() <= lookupNow.getTime()
  ) {
    return null;
  }

  // Capture the expiry before awaiting bcrypt. MongoDB returns a document
  // snapshot; this also keeps shared-object test doubles safe under concurrency.
  const inviteExpiresAtMs = user.inviteExpiresAt.getTime();

  const passwordHash = await hashPassword(password);
  // Re-read the clock after bcrypt so a token expiring during password hashing
  // cannot be accepted using a stale timestamp.
  const commitNow = nowProvider();
  if (inviteExpiresAtMs <= commitNow.getTime()) {
    return null;
  }

  const result = await users.updateOne(
    {
      _id: user._id,
      status: "invited",
      inviteTokenHash: tokenHash,
      inviteExpiresAt: { $gt: commitNow },
    },
    {
      $set: { passwordHash, status: "active" },
      $unset: { inviteTokenHash: "", inviteExpiresAt: "" },
    },
  );

  // The hash + status + expiry filter makes concurrent accepts single-winner.
  if (result.modifiedCount !== 1) {
    return null;
  }

  return {
    id: user._id.toHexString(),
    email: user.email,
    role: user.role,
  };
}
