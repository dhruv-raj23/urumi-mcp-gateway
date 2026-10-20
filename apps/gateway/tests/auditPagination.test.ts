import { describe, expect, it } from "vitest";
import { ObjectId, type Collection } from "mongodb";
import type { AuditLogDocument } from "../src/db/models.js";
import {
  AuditAccessError,
  AuditCursorError,
  listAuditLogPage,
} from "../src/audit/auditService.js";

const SECRET = "audit-pagination-test-session-secret";
const TS = new Date("2026-10-19T12:00:00.000Z");

function makeRowsCollection(seed: AuditLogDocument[] = []) {
  const rows = [...seed];
  const compare = (actual: unknown, condition: unknown): boolean => {
    if (condition instanceof ObjectId && actual instanceof ObjectId) {
      return actual.equals(condition);
    }
    if (condition instanceof Date && actual instanceof Date) {
      return actual.getTime() === condition.getTime();
    }
    if (typeof condition === "object" && condition !== null && "$lt" in condition) {
      const lt = (condition as { $lt: unknown }).$lt;
      if (actual instanceof Date && lt instanceof Date) return actual.getTime() < lt.getTime();
      if (actual instanceof ObjectId && lt instanceof ObjectId) return actual.toHexString() < lt.toHexString();
    }
    return actual === condition;
  };
  const matches = (row: AuditLogDocument, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([key, expected]) => {
      if (key === "$or") {
        return (expected as Array<Record<string, unknown>>).some((part) => matches(row, part));
      }
      return compare(row[key as keyof AuditLogDocument], expected);
    });

  const collection = {
    find: (filter: Record<string, unknown>) => ({
      sort: (sortSpec: Record<string, number>) => ({
        limit: (limit: number) => ({
          toArray: async () => rows
            .filter((row) => matches(row, filter))
            .sort((a, b) => {
              for (const [field, direction] of Object.entries(sortSpec)) {
                const left = a[field as keyof AuditLogDocument];
                const right = b[field as keyof AuditLogDocument];
                let comparison = 0;
                if (left instanceof Date && right instanceof Date) {
                  comparison = left.getTime() - right.getTime();
                } else if (left instanceof ObjectId && right instanceof ObjectId) {
                  comparison = left.toHexString().localeCompare(right.toHexString());
                }
                if (comparison !== 0) return comparison * direction;
              }
              return 0;
            })
            .slice(0, limit),
        }),
      }),
    }),
  };

  return { collection: collection as unknown as Collection<AuditLogDocument>, rows };
}

function row(id: string, userId = new ObjectId()): AuditLogDocument {
  return {
    _id: new ObjectId(id),
    ts: TS,
    userId,
    userEmail: "audit@example.com",
    source: "mcp",
    serverSlug: "woo",
    toolName: "list_products",
    durationMs: 4,
    outcome: "success",
    argsHash: "a".repeat(64),
  };
}

describe("signed audit pagination", () => {
  it("pages equal timestamps without gaps or duplicate rows", async () => {
    const owner = new ObjectId();
    const { collection } = makeRowsCollection([
      row("000000000000000000000001", owner),
      row("000000000000000000000002", owner),
      row("000000000000000000000003", owner),
      row("000000000000000000000004", owner),
      row("000000000000000000000005", owner),
    ]);
    const actor = { userId: new ObjectId(), role: "admin" as const };

    const first = await listAuditLogPage(collection, actor, { limit: 2 }, SECRET);
    const second = await listAuditLogPage(
      collection, actor, { limit: 2, cursor: first.nextCursor! }, SECRET,
    );
    const third = await listAuditLogPage(
      collection, actor, { limit: 2, cursor: second.nextCursor! }, SECRET,
    );

    const ids = [...first.items, ...second.items, ...third.items]
      .map((entry) => entry._id.toHexString());
    expect(ids).toEqual([
      "000000000000000000000005",
      "000000000000000000000004",
      "000000000000000000000003",
      "000000000000000000000002",
      "000000000000000000000001",
    ]);
    expect(new Set(ids).size).toBe(5);
    expect(first.nextCursor).toBeTruthy();
    expect(second.nextCursor).toBeTruthy();
    expect(third.nextCursor).toBeNull();
  });

  it("rejects a tampered cursor", async () => {
    const { collection } = makeRowsCollection([
      row("000000000000000000000001"),
      row("000000000000000000000002"),
    ]);
    const first = await listAuditLogPage(
      collection, { userId: new ObjectId(), role: "admin" }, { limit: 1 }, SECRET,
    );
    const valid = first.nextCursor!;
    const [payload, signature] = valid.split(".");
    const changedSignature = `${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`;
    await expect(listAuditLogPage(
      collection,
      { userId: new ObjectId(), role: "admin" },
      { limit: 1, cursor: `${payload}.${changedSignature}` },
      SECRET,
    )).rejects.toBeInstanceOf(AuditCursorError);
  });

  it("enforces member scope independently of cursor content", async () => {
    const member = new ObjectId();
    const other = new ObjectId();
    const { collection } = makeRowsCollection([row("000000000000000000000001", other)]);
    await expect(listAuditLogPage(
      collection,
      { userId: member, role: "member" },
      { limit: 10, userId: other, cursor: "tampered" },
      SECRET,
    )).rejects.toBeInstanceOf(AuditAccessError);
  });

  it("rejects limits above the contract maximum", async () => {
    const { collection } = makeRowsCollection();
    await expect(listAuditLogPage(
      collection, { userId: new ObjectId(), role: "admin" }, { limit: 101 }, SECRET,
    )).rejects.toThrow("Audit limit must be an integer between 1 and 100");
  });
});
