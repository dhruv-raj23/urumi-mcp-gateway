import { describe, expect, it, vi } from "vitest";
import type { Collection } from "mongodb";

import type { UserDocument } from "../src/db/models.js";
import { ensureBootstrapAdmin } from "../src/auth/bootstrap.js";
import { verifyPassword } from "../src/auth/passwords.js";

function fakeUsers(existingCount = 0) {
  const inserted: UserDocument[] = [];

  const users = {
    countDocuments: vi.fn(async () => existingCount),
    insertOne: vi.fn(async (document: UserDocument) => {
      inserted.push(document);
      return {
        acknowledged: true,
        insertedId: document._id,
      };
    }),
  };

  return {
    collection: users as unknown as Collection<UserDocument>,
    inserted,
    users,
  };
}

describe("bootstrap admin", () => {
  it("creates an active admin with a normalized email and password hash", async () => {
    const { collection, inserted } = fakeUsers();

    const result = await ensureBootstrapAdmin(
      collection,
      " Admin@Example.com ",
      "test-bootstrap-password",
    );

    expect(result).toBe("created");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.email).toBe("admin@example.com");
    expect(inserted[0]?.role).toBe("admin");
    expect(inserted[0]?.status).toBe("active");
    expect(inserted[0]?.passwordHash).not.toBe("test-bootstrap-password");

    await expect(
      verifyPassword("test-bootstrap-password", inserted[0]!.passwordHash),
    ).resolves.toBe(true);
  });

  it("does not change or create users after initialization", async () => {
    const { collection, inserted, users } = fakeUsers(1);

    const result = await ensureBootstrapAdmin(
      collection,
      undefined,
      undefined,
    );

    expect(result).toBe("already-initialized");
    expect(users.insertOne).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("requires credentials only when the collection is empty", async () => {
    const { collection } = fakeUsers();

    await expect(
      ensureBootstrapAdmin(collection, undefined, undefined),
    ).rejects.toThrow(
      "Bootstrap admin credentials are required when no users exist",
    );
  });
});
