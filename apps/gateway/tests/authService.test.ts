import { beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId, type Collection } from "mongodb";

import type { UserDocument } from "../src/db/models.js";
import { authenticateUser } from "../src/auth/authService.js";
import { hashPassword } from "../src/auth/passwords.js";

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword("correct-test-password");
});

function fakeUsers(documents: UserDocument[]) {
  const findOne = vi.fn(async (filter: { email: string }) =>
    documents.find((user) => user.email === filter.email) ?? null,
  );

  return {
    collection: { findOne } as unknown as Collection<UserDocument>,
    findOne,
  };
}

function makeUser(
  overrides: Partial<UserDocument> = {},
): UserDocument {
  return {
    _id: new ObjectId(),
    email: "member@example.com",
    passwordHash,
    role: "member",
    status: "active",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("authentication service", () => {
  it("authenticates an active user and normalizes the email", async () => {
    const user = makeUser();
    const { collection, findOne } = fakeUsers([user]);

    const principal = await authenticateUser(
      collection,
      "  MEMBER@EXAMPLE.COM ",
      "correct-test-password",
    );

    expect(findOne).toHaveBeenCalledWith({
      email: "member@example.com",
    });
    expect(principal).toEqual({
      id: user._id.toHexString(),
      email: "member@example.com",
      role: "member",
    });
    expect(principal).not.toHaveProperty("passwordHash");
    expect(principal).not.toHaveProperty("inviteTokenHash");
  });

  it("rejects an unknown email and an incorrect password", async () => {
    const { collection } = fakeUsers([makeUser()]);

    await expect(
      authenticateUser(
        collection,
        "unknown@example.com",
        "correct-test-password",
      ),
    ).resolves.toBeNull();

    await expect(
      authenticateUser(
        collection,
        "member@example.com",
        "incorrect-password",
      ),
    ).resolves.toBeNull();
  });

  it("rejects invited and disabled users", async () => {
    const invited = makeUser({
      status: "invited",
      inviteTokenHash: "test-only-hash",
    });
    const disabled = makeUser({
      _id: new ObjectId(),
      email: "disabled@example.com",
      status: "disabled",
    });

    const { collection } = fakeUsers([invited, disabled]);

    await expect(
      authenticateUser(
        collection,
        invited.email,
        "correct-test-password",
      ),
    ).resolves.toBeNull();

    await expect(
      authenticateUser(
        collection,
        disabled.email,
        "correct-test-password",
      ),
    ).resolves.toBeNull();
  });

  it("rejects empty login inputs", async () => {
    const { collection, findOne } = fakeUsers([makeUser()]);

    await expect(
      authenticateUser(collection, " ", "password"),
    ).resolves.toBeNull();

    await expect(
      authenticateUser(collection, "member@example.com", ""),
    ).resolves.toBeNull();

    expect(findOne).not.toHaveBeenCalled();
  });
});
