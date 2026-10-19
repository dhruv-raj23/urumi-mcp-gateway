import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Collection } from "mongodb";

import type { AuditLogDocument } from "../src/db/models.js";
import {
  AuditAccessError,
  listAuditLogs,
  writeAuditLog,
} from "../src/audit/auditService.js";

function fakeAuditCollection() {
  const rows: AuditLogDocument[] = [];

  const collection = {
    insertOne: vi.fn(async (row: AuditLogDocument) => {
      rows.push(row);
      return { acknowledged: true, insertedId: row._id };
    }),
    find: vi.fn((filter: Record<string, unknown>) => ({
      sort: () => ({
        limit: (limit: number) => ({
          toArray: async () =>
            rows
              .filter((row) =>
                Object.entries(filter).every(([key, value]) => {
                  const actual = row[key as keyof AuditLogDocument];
                  if (actual instanceof ObjectId && value instanceof ObjectId) {
                    return actual.equals(value);
                  }
                  return actual === value;
                }),
              )
              .sort((a, b) => b.ts.getTime() - a.ts.getTime())
              .slice(0, limit),
        }),
      }),
    })),
  };

  return {
    collection: collection as unknown as Collection<AuditLogDocument>,
    rows,
    methods: collection,
  };
}

describe("audit service", () => {
  it("stores a hash of arguments without storing arguments or raw errors", async () => {
    const { collection, rows } = fakeAuditCollection();

    await writeAuditLog(collection, {
      userId: new ObjectId(),
      userEmail: "member@example.com",
      source: "mcp",
      serverSlug: "woo",
      toolName: "list_orders",
      durationMs: 12,
      outcome: "success",
      args: { customerId: 123 },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.argsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]).not.toHaveProperty("args");
    expect(rows[0]).not.toHaveProperty("errorMessage");
  });

  it("filters members to their own audit entries", async () => {
    const { collection } = fakeAuditCollection();
    const memberA = new ObjectId();
    const memberB = new ObjectId();

    const write = (userId: ObjectId, userEmail: string) =>
      writeAuditLog(collection, {
        userId,
        userEmail,
        source: "mcp",
        serverSlug: "woo",
        toolName: "list_products",
        durationMs: 10,
        outcome: "success",
        args: {},
      });

    await write(memberA, "a@example.com");
    await write(memberB, "b@example.com");

    const result = await listAuditLogs(
      collection,
      { userId: memberA, role: "member" },
      { limit: 10 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.userId.equals(memberA)).toBe(true);
  });

  it("rejects a member attempting to filter for another user's records", async () => {
    const { collection } = fakeAuditCollection();

    await expect(
      listAuditLogs(
        collection,
        { userId: new ObjectId(), role: "member" },
        { limit: 10, userId: new ObjectId() },
      ),
    ).rejects.toBeInstanceOf(AuditAccessError);
  });

  it("allows admins to filter entries by user, server, and outcome", async () => {
    const { collection, methods } = fakeAuditCollection();
    const member = new ObjectId();

    await writeAuditLog(collection, {
      userId: member,
      userEmail: "member@example.com",
      source: "chat",
      serverSlug: "woo",
      toolName: "list_orders",
      durationMs: 25,
      outcome: "error",
      args: { page: 1 },
    });

    const result = await listAuditLogs(
      collection,
      { userId: new ObjectId(), role: "admin" },
      { limit: 20, userId: member, server: "woo", outcome: "error" },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.serverSlug).toBe("woo");
    expect(methods.find).toHaveBeenCalledWith({
      userId: member,
      serverSlug: "woo",
      outcome: "error",
    });
  });

  it("rejects invalid durations and limits", async () => {
    const { collection } = fakeAuditCollection();

    await expect(
      writeAuditLog(collection, {
        userId: new ObjectId(),
        userEmail: "member@example.com",
        source: "mcp",
        serverSlug: "woo",
        toolName: "list_orders",
        durationMs: -1,
        outcome: "error",
        args: {},
      }),
    ).rejects.toThrow("Audit duration must be a non-negative number");

    await expect(
      listAuditLogs(
        collection,
        { userId: new ObjectId(), role: "admin" },
        { limit: 0 },
      ),
    ).rejects.toThrow("Audit limit must be a positive integer");
  });
});
