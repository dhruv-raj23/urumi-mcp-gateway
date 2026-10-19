import { createHash } from "node:crypto";
import { ObjectId, type Collection } from "mongodb";
import { describe, expect, it } from "vitest";

import {
  acceptInvitation,
  INVITATION_TTL_MS,
  issueInvitation,
} from "../src/auth/invitations.js";
import type { UserDocument } from "../src/db/models.js";

function makeUsersCollection() {
  const documents: UserDocument[] = [];

  const matches = (user: UserDocument, filter: Record<string, unknown>) => {
    if (filter._id instanceof ObjectId && !user._id.equals(filter._id)) return false;
    if (typeof filter.email === "string" && user.email !== filter.email) return false;
    if (
      typeof filter.inviteTokenHash === "string" &&
      user.inviteTokenHash !== filter.inviteTokenHash
    ) return false;
    if (typeof filter.status === "string" && user.status !== filter.status) return false;

    const expiryFilter = filter.inviteExpiresAt as { $gt?: Date } | undefined;
    if (expiryFilter?.$gt) {
      if (!user.inviteExpiresAt || user.inviteExpiresAt.getTime() <= expiryFilter.$gt.getTime()) {
        return false;
      }
    }
    return true;
  };

  const collection = {
    findOne: async (filter: Record<string, unknown>) =>
      documents.find((user) => matches(user, filter)) ?? null,
    insertOne: async (document: UserDocument) => {
      if (documents.some((user) => user.email === document.email)) {
        throw Object.assign(new Error("duplicate email"), { code: 11000 });
      }
      documents.push({ ...document });
      return { acknowledged: true, insertedId: document._id };
    },
    updateOne: async (
      filter: Record<string, unknown>,
      update: {
        $set?: Partial<UserDocument>;
        $unset?: Record<string, unknown>;
      },
    ) => {
      const user = documents.find((candidate) => matches(candidate, filter));
      if (!user) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      Object.assign(user, update.$set ?? {});
      for (const key of Object.keys(update.$unset ?? {})) {
        delete (user as unknown as Record<string, unknown>)[key];
      }
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
  } as unknown as Collection<UserDocument>;

  return { collection, documents };
}

const FIXED_NOW = new Date("2026-10-19T00:00:00.000Z");

 describe("invitation service", () => {
  it("stores only a SHA-256 hash and accepts a token once", async () => {
    const { collection, documents } = makeUsersCollection();
    const issue = await issueInvitation(
      collection,
      "  new.user@example.com ",
      "member",
      () => FIXED_NOW,
    );

    expect(issue.kind).toBe("issued");
    if (issue.kind !== "issued") throw new Error("Expected an issued invitation");

    const stored = documents[0];
    expect(stored?.email).toBe("new.user@example.com");
    expect(stored?.inviteTokenHash).toBe(
      createHash("sha256").update(issue.invitation.token).digest("hex"),
    );
    expect(stored?.inviteTokenHash).not.toBe(issue.invitation.token);
    expect(stored?.inviteTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(issue.invitation.token);
    expect(stored?.inviteExpiresAt?.getTime()).toBe(
      FIXED_NOW.getTime() + INVITATION_TTL_MS,
    );

    const accepted = await acceptInvitation(
      collection,
      issue.invitation.token,
      "a-long-password-123",
      () => FIXED_NOW,
    );
    expect(accepted).toMatchObject({
      id: issue.invitation.id,
      email: "new.user@example.com",
      role: "member",
    });
    expect(stored?.status).toBe("active");
    expect(stored?.inviteTokenHash).toBeUndefined();
    expect(stored?.inviteExpiresAt).toBeUndefined();

    const secondAccept = await acceptInvitation(
      collection,
      issue.invitation.token,
      "another-password-123",
      () => FIXED_NOW,
    );
    expect(secondAccept).toBeNull();
  });

  it("rejects expired tokens without sleeping", async () => {
    const { collection } = makeUsersCollection();
    let clock = new Date(FIXED_NOW);
    const issue = await issueInvitation(
      collection,
      "expired@example.com",
      "member",
      () => clock,
    );
    if (issue.kind !== "issued") throw new Error("Expected an issued invitation");

    // Advance the injected clock beyond expiry; no real-time sleep is needed.
    clock = new Date(issue.invitation.expiresAt.getTime() + 1);
    await expect(
      acceptInvitation(
        collection,
        issue.invitation.token,
        "a-long-password-123",
        () => clock,
      ),
    ).resolves.toBeNull();
  });

  it("invalidates the old token when an invited user is re-invited", async () => {
    const { collection, documents } = makeUsersCollection();
    const first = await issueInvitation(
      collection,
      "rotate@example.com",
      "member",
      () => FIXED_NOW,
    );
    if (first.kind !== "issued") throw new Error("Expected an issued invitation");

    const later = new Date(FIXED_NOW.getTime() + 60_000);
    const second = await issueInvitation(
      collection,
      "rotate@example.com",
      "admin",
      () => later,
    );
    expect(second.kind).toBe("reissued");
    if (second.kind !== "reissued") throw new Error("Expected a re-issued invitation");
    expect(second.invitation.token).not.toBe(first.invitation.token);
    expect(documents).toHaveLength(1);
    expect(documents[0]?.role).toBe("admin");

    await expect(
      acceptInvitation(
        collection,
        first.invitation.token,
        "a-long-password-123",
        () => later,
      ),
    ).resolves.toBeNull();

    await expect(
      acceptInvitation(
        collection,
        second.invitation.token,
        "a-long-password-123",
        () => later,
      ),
    ).resolves.toMatchObject({ email: "rotate@example.com", role: "admin" });
  });

  it("allows exactly one of two concurrent accepts", async () => {
    const { collection } = makeUsersCollection();
    const issue = await issueInvitation(
      collection,
      "race@example.com",
      "member",
      () => FIXED_NOW,
    );
    if (issue.kind !== "issued") throw new Error("Expected an issued invitation");

    const outcomes = await Promise.all([
      acceptInvitation(collection, issue.invitation.token, "password-number-123", () => FIXED_NOW),
      acceptInvitation(collection, issue.invitation.token, "password-number-456", () => FIXED_NOW),
    ]);
    expect(outcomes.filter((result) => result !== null)).toHaveLength(1);
    expect(outcomes.filter((result) => result === null)).toHaveLength(1);
  });

  it("does not re-invite a disabled account without explicit reactivation", async () => {
    const { collection, documents } = makeUsersCollection();
    const disabled: UserDocument = {
      _id: new ObjectId(),
      email: "disabled-invite@example.com",
      passwordHash: "fake-hash",
      role: "member",
      status: "disabled",
      createdAt: FIXED_NOW,
    };
    documents.push(disabled);

    await expect(
      issueInvitation(
        collection,
        "disabled-invite@example.com",
        "member",
        () => FIXED_NOW,
      ),
    ).resolves.toEqual({ kind: "state-conflict" });

    expect(disabled.status).toBe("disabled");
    expect(disabled.inviteTokenHash).toBeUndefined();
    expect(disabled.inviteExpiresAt).toBeUndefined();
  });

  it("returns conflict for an already-active email", async () => {
    const { collection, documents } = makeUsersCollection();
    documents.push({
      _id: new ObjectId(),
      email: "active@example.com",
      passwordHash: "existing-hash",
      role: "member",
      status: "active",
      createdAt: FIXED_NOW,
    });
    await expect(
      issueInvitation(collection, "active@example.com", "admin", () => FIXED_NOW),
    ).resolves.toEqual({ kind: "active-conflict" });
  });
});
