import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ObjectId, type Collection } from "mongodb";

import {
  createUserApiKey,
  findActiveApiKey,
} from "../src/auth/apiKeyService.js";
import { hashPassword } from "../src/auth/passwords.js";
import { decryptCredential } from "../src/crypto/credentials.js";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth/session.js";
import { createGatewayServer } from "../src/http/app.js";
import type { GatewayCollections } from "../src/db/mongo.js";
import type {AuditLogDocument, ApiKeyDocument, ServerDocument, UserDocument} from "../src/db/models.js";

const TEST_SECRET = "http-test-session-secret";
const secureCookie = false;

let passwordHash: string;
const auditDocuments: AuditLogDocument[] = [];
const serverDocuments: ServerDocument[] = [];
const memberId = new ObjectId();
const adminId = new ObjectId();
const disabledId = new ObjectId();
let failingDiscoverySlug: string | null = null;

function makeUser(
  id: ObjectId,
  email: string,
  role: UserDocument["role"],
  status: UserDocument["status"] = "active",
): UserDocument {
  return {
    _id: id,
    email,
    passwordHash,
    role,
    status,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
  };
}

function buildFakeCollections(users: UserDocument[]): GatewayCollections {
  const usersCollection = {
    findOne: async (filter: {
      email?: string;
      _id?: ObjectId;
      inviteTokenHash?: string;
      status?: UserDocument["status"];
      inviteExpiresAt?: Date | { $gt: Date };
    }) => {
      return users.find((user) => {
        if (filter.email !== undefined && user.email !== filter.email) return false;
        if (filter._id && !user._id.equals(filter._id)) return false;
        if (filter.inviteTokenHash !== undefined && user.inviteTokenHash !== filter.inviteTokenHash) return false;
        if (filter.status !== undefined && user.status !== filter.status) return false;
        if (filter.inviteExpiresAt) {
          const expiresAfter = filter.inviteExpiresAt instanceof Date
            ? filter.inviteExpiresAt
            : filter.inviteExpiresAt.$gt;
          if (!expiresAfter || !user.inviteExpiresAt || user.inviteExpiresAt.getTime() <= expiresAfter.getTime()) return false;
        }
        return true;
      }) ?? null;
    },
    insertOne: async (document: UserDocument) => {
      if (users.some((user) => user.email === document.email)) {
        throw Object.assign(new Error("duplicate email"), { code: 11000 });
      }
      users.push(document);
      return { acknowledged: true, insertedId: document._id };
    },
    updateOne: async (
      filter: {
        _id?: ObjectId;
        role?: UserDocument["role"];
        status?: UserDocument["status"];
        inviteTokenHash?: string;
        inviteExpiresAt?: { $gt: Date };
      },
      update: { $set?: Partial<UserDocument>; $unset?: Record<string, unknown> },
    ) => {
      const user = users.find((candidate) => {
        if (filter._id && !candidate._id.equals(filter._id)) return false;
        if (filter.role && candidate.role !== filter.role) return false;
        if (filter.status && candidate.status !== filter.status) return false;
        if (filter.inviteTokenHash && candidate.inviteTokenHash !== filter.inviteTokenHash) return false;
        if (filter.inviteExpiresAt?.$gt) {
          if (!candidate.inviteExpiresAt || candidate.inviteExpiresAt.getTime() <= filter.inviteExpiresAt.$gt.getTime()) return false;
        }
        return true;
      });
      if (!user) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      Object.assign(user, update.$set ?? {});
      for (const field of Object.keys(update.$unset ?? {})) {
        delete (user as unknown as Record<string, unknown>)[field];
      }
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
    find: () => ({
      sort: () => ({
        toArray: async () =>
          [...users].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          ),
      }),
    }),
  } as unknown as Collection<UserDocument>;

  const serversCollection = {
    find: (filter: Partial<ServerDocument> = {}) => ({
      sort: () => ({
        toArray: async () => [...serverDocuments]
          .filter((entry) => Object.entries(filter).every(
            ([key, value]) => entry[key as keyof ServerDocument] === value,
          ))
          .sort((a, b) => a.slug.localeCompare(b.slug)),
      }),
    }),
    findOne: async (filter: { _id?: ObjectId; slug?: string }) =>
      serverDocuments.find((server) =>
        (!filter._id || server._id.equals(filter._id)) &&
        (filter.slug === undefined || server.slug === filter.slug),
      ) ?? null,
    insertOne: async (document: ServerDocument) => {
      if (serverDocuments.some((server) => server.slug === document.slug)) {
        throw Object.assign(new Error("duplicate slug"), { code: 11000 });
      }
      serverDocuments.push(document);
      return { acknowledged: true, insertedId: document._id };
    },
    updateOne: async (
      filter: { _id: ObjectId },
      update: { $set?: Partial<ServerDocument>; $unset?: Record<string, unknown> },
    ) => {
      const server = serverDocuments.find((candidate) => candidate._id.equals(filter._id));
      if (!server) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      Object.assign(server, update.$set ?? {});
      for (const field of Object.keys(update.$unset ?? {})) {
        delete (server as unknown as Record<string, unknown>)[field];
      }
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
    deleteOne: async (filter: { _id: ObjectId }) => {
      const index = serverDocuments.findIndex((candidate) => candidate._id.equals(filter._id));
      if (index < 0) return { acknowledged: true, deletedCount: 0 };
      serverDocuments.splice(index, 1);
      return { acknowledged: true, deletedCount: 1 };
    },
  } as unknown as Collection<ServerDocument>;

  const apiKeyDocuments: ApiKeyDocument[] = [];

  const apiKeysCollection = {
    insertOne: async (document: ApiKeyDocument) => {
      apiKeyDocuments.push(document);
      return { acknowledged: true, insertedId: document._id };
    },
    find: (filter: { userId?: ObjectId }) => ({
      sort: () => ({
        toArray: async () =>
          apiKeyDocuments
            .filter(
              (document) =>
                !filter.userId || document.userId.equals(filter.userId),
            )
            .sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            ),
      }),
    }),
    findOne: async (filter: { prefix?: string }) =>
      apiKeyDocuments.find(
        (document) => document.prefix === filter.prefix,
      ) ?? null,
    updateOne: async (
      filter: {
        _id: ObjectId;
        userId?: ObjectId;
        hash?: string;
        revokedAt?: { $exists?: boolean };
      },
      update: {
        $set: Partial<Pick<ApiKeyDocument, "revokedAt" | "lastUsedAt">>;
      },
    ) => {
      const document = apiKeyDocuments.find((candidate) => {
        if (!candidate._id.equals(filter._id)) return false;
        if (filter.userId && !candidate.userId.equals(filter.userId)) return false;
        if (filter.hash && candidate.hash !== filter.hash) return false;
        if (filter.revokedAt?.$exists === false && candidate.revokedAt !== undefined) {
          return false;
        }
        return true;
      });

      if (!document) {
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      }

      Object.assign(document, update.$set);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
  } as unknown as Collection<ApiKeyDocument>;

  const auditLogsCollection = {
    insertOne: async (document: AuditLogDocument) => {
      auditDocuments.push(document);
      return { acknowledged: true, insertedId: document._id };
    },
    find: (filter: Record<string, unknown>) => ({
      sort: (sortSpec: Record<string, number>) => ({
        limit: (limit: number) => ({
          toArray: async () => {
            const compareValue = (actual: unknown, expected: unknown): boolean => {
              if (actual instanceof ObjectId && expected instanceof ObjectId) return actual.equals(expected);
              if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
              if (typeof expected === "object" && expected !== null && "$lt" in expected) {
                const lt = (expected as { $lt: unknown }).$lt;
                if (actual instanceof Date && lt instanceof Date) return actual.getTime() < lt.getTime();
                if (actual instanceof ObjectId && lt instanceof ObjectId) return actual.toHexString() < lt.toHexString();
              }
              return actual === expected;
            };
            const matches = (row: AuditLogDocument, query: Record<string, unknown>): boolean =>
              Object.entries(query).every(([key, expected]) => {
                if (key === "$or") return (expected as Array<Record<string, unknown>>).some((part) => matches(row, part));
                return compareValue(row[key as keyof AuditLogDocument], expected);
              });
            return auditDocuments
              .filter((row) => matches(row, filter))
              .sort((a, b) => {
                for (const [field, direction] of Object.entries(sortSpec)) {
                  const left = a[field as keyof AuditLogDocument];
                  const right = b[field as keyof AuditLogDocument];
                  let comparison = 0;
                  if (left instanceof Date && right instanceof Date) comparison = left.getTime() - right.getTime();
                  else if (left instanceof ObjectId && right instanceof ObjectId) comparison = left.toHexString().localeCompare(right.toHexString());
                  if (comparison !== 0) return comparison * direction;
                }
                return 0;
              })
              .slice(0, limit);
          },
        }),
      }),
    }),
  } as unknown as Collection<AuditLogDocument>;

  return {
    users: usersCollection,
    apikeys: apiKeysCollection,
    servers: serversCollection,
    auditlogs: auditLogsCollection,
  };
}

let collections: GatewayCollections;
let server: ReturnType<typeof createGatewayServer>;
let baseUrl: string;

beforeAll(async () => {
  passwordHash = await hashPassword("correct-test-password");

  collections = buildFakeCollections([
    makeUser(memberId, "member@example.com", "member"),
    makeUser(adminId, "admin@example.com", "admin"),
    makeUser(disabledId, "disabled@example.com", "member", "disabled"),
  ]);

  server = createGatewayServer(collections, {
    sessionSecret: TEST_SECRET,
    cookieSecure: secureCookie,
    credentialEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
    enableHealthLoop: false,
    clientFactory: async (upstream) => ({
      listTools: async () => {
        if (failingDiscoverySlug === upstream.slug) {
          throw new Error("simulated upstream discovery failure");
        }
        return {
          tools: [{
            name: "echo",
            description: "Echo test tool",
            inputSchema: { type: "object" as const, properties: {} },
          }],
        };
      },
      callTool: async () => ({
        content: [{ type: "text" as const, text: "test result" }],
      }),
      close: async () => undefined,
    }),
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test HTTP server did not bind to a TCP port");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

async function login(email: string, password: string) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

function sessionCookie(userId: ObjectId, nowSeconds?: number) {
  const token = nowSeconds === undefined
    ? createSessionToken(userId.toHexString(), TEST_SECRET)
    : createSessionToken(userId.toHexString(), TEST_SECRET, nowSeconds);

  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("gateway authentication HTTP routes", () => {
  it("returns 200 and sets the expected local session cookie for a valid login", async () => {
    const response = await login("member@example.com", "correct-test-password");
    const body = await response.json() as { user: { id: string; role: string } };
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(body.user.id).toBe(memberId.toHexString());
    expect(body.user.role).toBe("member");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("; Secure");
  });

  it("returns 401 for a wrong password", async () => {
    const response = await login("member@example.com", "wrong-test-password");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_credentials",
        message: "Invalid email or password",
      },
    });
  });

  it("does not reveal whether an email exists", async () => {
    const wrongPassword = await login(
      "member@example.com",
      "wrong-test-password",
    );
    const unknownEmail = await login(
      "unknown@example.com",
      "wrong-test-password",
    );

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(await unknownEmail.json()).toEqual(await wrongPassword.json());
  });

  it("rejects state-changing API requests without JSON content type", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      body: "email=member@example.com&password=anything",
    });

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_media_type" },
    });
  });

  it("rejects a tampered session cookie", async () => {
    const valid = createSessionToken(memberId.toHexString(), TEST_SECRET);
    const [payload, signature] = valid.split(".");
    const changedSignature = `${signature?.startsWith("A") ? "B" : "A"}${signature?.slice(1)}`;

    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${payload}.${changedSignature}`,
      },
    });

    expect(response.status).toBe(401);
  });

  it("rejects an expired session cookie", async () => {
    const cookie = sessionCookie(memberId, 1);

    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie },
    });

    expect(response.status).toBe(401);
  });

  it("rejects a disabled account even with a valid cookie", async () => {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: sessionCookie(disabledId) },
    });

    expect(response.status).toBe(401);
  });

  it("returns 403 when a member calls the admin-only users route", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      headers: { cookie: sessionCookie(memberId) },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("rejects a member attempting to invite a user", async () => {
    const response = await fetch(`${baseUrl}/api/users/invite`, {
      method: "POST",
      headers: {
        cookie: sessionCookie(memberId),
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "new@example.com", role: "member" }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects unknown fields in an invitation request", async () => {
    const response = await fetch(`${baseUrl}/api/users/invite`, {
      method: "POST",
      headers: {
        cookie: sessionCookie(adminId),
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "new@example.com", role: "member", extra: true }),
    });

    expect(response.status).toBe(400);
  });

  it("allows an admin to list users without returning password hashes", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      headers: { cookie: sessionCookie(adminId) },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { users: Array<Record<string, unknown>> };
    expect(body.users).toHaveLength(3);
    expect(body.users[0]).not.toHaveProperty("passwordHash");
    expect(body.users[0]).not.toHaveProperty("inviteTokenHash");
  });

  it("requires an authenticated administrator to disable a member", async () => {
    const target = makeUser(
      new ObjectId(),
      "disable-auth-check@example.com",
      "member",
    );
    await collections.users.insertOne(target);

    const endpoint = `${baseUrl}/api/users/${target._id.toHexString()}`;
    const request = (cookie?: string) =>
      fetch(endpoint, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({ status: "disabled" }),
      });

    expect((await request()).status).toBe(401);
    expect((await request(sessionCookie(memberId))).status).toBe(403);
    expect(target.status).toBe("active");
  });

  it("validates member-disable IDs and strict request bodies", async () => {
    const cases = [
      {
        label: "malformed ID",
        id: "not-an-object-id",
        body: { status: "disabled" },
        expectedStatus: 400,
      },
      {
        label: "unsupported status",
        id: memberId.toHexString(),
        body: { status: "active" },
        expectedStatus: 400,
      },
      {
        label: "unknown field",
        id: memberId.toHexString(),
        body: { status: "disabled", role: "admin" },
        expectedStatus: 400,
      },
      {
        label: "missing user",
        id: new ObjectId().toHexString(),
        body: { status: "disabled" },
        expectedStatus: 404,
      },
    ];

    for (const testCase of cases) {
      const response = await fetch(
        `${baseUrl}/api/users/${testCase.id}`,
        {
          method: "PATCH",
          headers: {
            cookie: sessionCookie(adminId),
            "content-type": "application/json",
          },
          body: JSON.stringify(testCase.body),
        },
      );

      expect(response.status, testCase.label).toBe(testCase.expectedStatus);
    }
  });

  it("does not allow an administrator account to be disabled", async () => {
    const response = await fetch(
      `${baseUrl}/api/users/${adminId.toHexString()}`,
      {
        method: "PATCH",
        headers: {
          cookie: sessionCookie(adminId),
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "disabled" }),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "user_not_disableable" },
    });
  });

  it("disables an active member, invalidates access, and is idempotent", async () => {
    const target = makeUser(
      new ObjectId(),
      "disable-active-member@example.com",
      "member",
    );
    await collections.users.insertOne(target);

    const createdKey = await createUserApiKey(
      collections.apikeys,
      target._id,
      "member disable regression",
    );

    const endpoint = `${baseUrl}/api/users/${target._id.toHexString()}`;
    const disable = () =>
      fetch(endpoint, {
        method: "PATCH",
        headers: {
          cookie: sessionCookie(adminId),
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "disabled" }),
      });

    const response = await disable();
    expect(response.status).toBe(200);

    const body = await response.json() as {
      user: Record<string, unknown>;
    };
    expect(body.user).toEqual({
      id: target._id.toHexString(),
      email: target.email,
      role: "member",
      status: "disabled",
      createdAt: target.createdAt.toISOString(),
    });
    expect(body.user).not.toHaveProperty("passwordHash");
    expect(body.user).not.toHaveProperty("inviteTokenHash");

    const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: sessionCookie(target._id) },
    });
    expect(sessionResponse.status).toBe(401);

    const apiKeyResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${createdKey.key}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(apiKeyResponse.status).toBe(401);

    const repeated = await disable();
    expect(repeated.status).toBe(200);
    await expect(repeated.json()).resolves.toMatchObject({
      user: {
        id: target._id.toHexString(),
        status: "disabled",
      },
    });
  });

  it("disables an invited member and clears invitation state", async () => {
    const target = makeUser(
      new ObjectId(),
      "disable-invited-member@example.com",
      "member",
      "invited",
    );
    target.inviteTokenHash = "fixture-invite-hash";
    target.inviteExpiresAt = new Date("2026-10-22T00:00:00.000Z");
    await collections.users.insertOne(target);

    const response = await fetch(
      `${baseUrl}/api/users/${target._id.toHexString()}`,
      {
        method: "PATCH",
        headers: {
          cookie: sessionCookie(adminId),
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "disabled" }),
      },
    );

    expect(response.status).toBe(200);

    const stored = await collections.users.findOne({ _id: target._id });
    expect(stored?.status).toBe("disabled");
    expect(stored?.inviteTokenHash).toBeUndefined();
    expect(stored?.inviteExpiresAt).toBeUndefined();
  });

  it("issues a no-store invitation and accepts its token exactly once", async () => {
    const inviteResponse = await fetch(`${baseUrl}/api/users/invite`, {
      method: "POST",
      headers: {
        cookie: sessionCookie(adminId),
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "invited-flow@example.com", role: "member" }),
    });

    expect(inviteResponse.status).toBe(201);
    expect(inviteResponse.headers.get("cache-control")).toBe("no-store");
    const inviteBody = await inviteResponse.json() as {
      token: string;
      invitation: { id: string; email: string; role: string; status: string; expiresAt: string };
    };
    expect(inviteBody.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inviteBody.invitation).toMatchObject({
      email: "invited-flow@example.com",
      role: "member",
      status: "invited",
    });
    expect(Math.abs(Date.parse(inviteBody.invitation.expiresAt) - Date.now() - 24 * 60 * 60 * 1000)).toBeLessThan(5000);

    const stored = await collections.users.findOne({ email: "invited-flow@example.com" });
    expect(stored).not.toBeNull();
    expect(stored?.inviteTokenHash).not.toBe(inviteBody.token);
    expect(stored?.inviteTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(inviteBody.token);

    const acceptResponse = await fetch(`${baseUrl}/api/auth/accept-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: inviteBody.token, password: ["a-long-password-", "123"].join("") }),
    });
    expect(acceptResponse.status).toBe(200);
    await expect(acceptResponse.json()).resolves.toMatchObject({
      user: { id: inviteBody.invitation.id, email: "invited-flow@example.com", status: "active" },
    });
    const acceptedUser = await collections.users.findOne({ email: "invited-flow@example.com" });
    expect(acceptedUser?.inviteTokenHash).toBeUndefined();
    expect(acceptedUser?.inviteExpiresAt).toBeUndefined();

    const reusedResponse = await fetch(`${baseUrl}/api/auth/accept-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: inviteBody.token, password: ["another-password-", "123"].join("") }),
    });
    const unknownResponse = await fetch(`${baseUrl}/api/auth/accept-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: ["a-completely-unknown-", "token"].join(""), password: ["another-password-", "123"].join("") }),
    });
    expect(reusedResponse.status).toBe(400);
    expect(unknownResponse.status).toBe(400);
    await expect(reusedResponse.json()).resolves.toEqual(await unknownResponse.json());
  });

  it.each([
    ["too-short password", "short"],
    ["password over 72 UTF-8 bytes", "🚀".repeat(19)],
  ])("rejects an %s during invitation acceptance", async (_label, password) => {
    const response = await fetch(`${baseUrl}/api/auth/accept-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: ["syntactically-valid-unknown-", "token"].join(""), password }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 409 when an admin attempts to invite a disabled account", async () => {
    const email = "disabled-http-invite@example.com";
    await collections.users.insertOne({
      _id: new ObjectId(),
      email,
      passwordHash: "fake-hash",
      role: "member",
      status: "disabled",
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    });

    const response = await fetch(`${baseUrl}/api/users/invite`, {
      method: "POST",
      headers: {
        cookie: sessionCookie(adminId),
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, role: "member" }),
    });

    expect(response.status).toBe(409);
  });

  it("logout clears the cookie with matching local cookie flags", async () => {
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("; Secure");
  });

  it("serves health checks without authentication", async () => {
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("rejects unknown fields, including userId, when creating a key", async () => {
    const response = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: {
        cookie: sessionCookie(adminId),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Not allowed",
        userId: memberId.toHexString(),
      }),
    });

    expect(response.status).toBe(400);
  });

  it.each([
    ["empty name", ""],
    ["whitespace-only name", "   "],
    ["101-character name", "x".repeat(101)],
  ])("rejects %s when creating a key", async (_label, name) => {
    const response = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: {
        cookie: sessionCookie(memberId),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name }),
    });

    expect(response.status).toBe(400);
  });

  it("creates a key once, verifies it, lists metadata only, and revokes it immediately", async () => {
    const response = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: {
        cookie: sessionCookie(memberId),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "  My integration  " }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json() as {
      key: string;
      apiKey: Record<string, unknown>;
    };

    expect(body.key).toMatch(/^urumi_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(body.apiKey.name).toBe("My integration");
    expect(body.apiKey.prefix).toBe(body.key.split("_")[1]);
    expect(body.apiKey).toHaveProperty("id");
    expect(body.apiKey).toHaveProperty("createdAt");
    expect(Object.keys(body.apiKey).sort()).toEqual([
      "createdAt",
      "id",
      "name",
      "prefix",
    ]);

    const stored = await findActiveApiKey(collections.apikeys, body.key);
    expect(stored).not.toBeNull();
    expect(stored?.hash).not.toBe(body.key);
    expect(stored).not.toHaveProperty("key");

    const listResponse = await fetch(`${baseUrl}/api/keys`, {
      headers: { cookie: sessionCookie(memberId) },
    });

    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as {
      keys: Array<Record<string, unknown>>;
    };

    expect(JSON.stringify(listed)).not.toContain(body.key);

    const listedKey = listed.keys.find(
      (entry) => entry.id === body.apiKey.id,
    );

    expect(listedKey).toBeDefined();
    expect(Object.keys(listedKey ?? {}).sort()).toEqual([
      "createdAt",
      "id",
      "name",
      "prefix",
    ]);

    const revokeResponse = await fetch(
      `${baseUrl}/api/keys/${String(body.apiKey.id)}`,
      {
        method: "DELETE",
        headers: {
          cookie: sessionCookie(memberId),
          "content-type": "application/json",
        },
      },
    );

    expect(revokeResponse.status).toBe(200);
    await expect(
      findActiveApiKey(collections.apikeys, body.key),
    ).resolves.toBeNull();
  });

  it("allows members to read servers but denies server writes", async () => {
    const listResponse = await fetch(`${baseUrl}/api/servers`, {
      headers: { cookie: sessionCookie(memberId) },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({ servers: [] });

    const writeResponse = await fetch(`${baseUrl}/api/servers`, {
      method: "POST",
      headers: {
        cookie: sessionCookie(memberId),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        slug: "member-server",
        name: "Member server",
        url: "http://woo-mcp:3001/mcp",
        authType: "none",
      }),
    });
    expect(writeResponse.status).toBe(403);
  });

  it("rejects bearer server creation without a credential", async () => {
    const response = await fetch(`${baseUrl}/api/servers`, {
      method: "POST",
      headers: {
        cookie: sessionCookie(adminId),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        slug: "bearer-missing",
        name: "Missing bearer credential",
        url: "http://woo-mcp:3001/mcp",
        authType: "bearer",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects invalid URL user-info, reserved headers, and CR/LF credentials", async () => {
    const base = {
      name: "Validation test",
      url: "http://woo-mcp:3001/mcp",
      authType: "header",
      credential: "header-credential-test",
      headerName: "X-Upstream-Token",
    };
    const userInfo = await fetch(`${baseUrl}/api/servers`, {
      method: "POST",
      headers: { cookie: sessionCookie(adminId), "content-type": "application/json" },
      body: JSON.stringify({ ...base, slug: "url-user-info", url: "http://user:pass@woo-mcp:3001/mcp" }),
    });
    expect(userInfo.status).toBe(400);

    const reservedHeader = await fetch(`${baseUrl}/api/servers`, {
      method: "POST",
      headers: { cookie: sessionCookie(adminId), "content-type": "application/json" },
      body: JSON.stringify({ ...base, slug: "reserved-header", headerName: "Content-Type" }),
    });
    expect(reservedHeader.status).toBe(400);

    const injectedCredential = await fetch(`${baseUrl}/api/servers`, {
      method: "POST",
      headers: { cookie: sessionCookie(adminId), "content-type": "application/json" },
      body: JSON.stringify({ ...base, slug: "credential-injection", credential: "first-line\r\nInjected: true" }),
    });
    expect(injectedCredential.status).toBe(400);
  });

  it("returns redacted server data and encrypts the upstream credential at rest", async () => {
    const credential = "upstream-secret-for-test-only";
    const response = await fetch(`${baseUrl}/api/servers`, {
      method: "POST",
      headers: { cookie: sessionCookie(adminId), "content-type": "application/json" },
      body: JSON.stringify({
        slug: "credential-server",
        name: "Credential server",
        url: "http://woo-mcp:3001/mcp",
        authType: "bearer",
        credential,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { server: Record<string, unknown> };
    expect(body.server.hasCredential).toBe(true);
    expect(body.server.status).toBe("unreachable");
    expect(body.server.statusReason).toBe("not checked yet");
    expect(body.server.toolCount).toBe(0);
    expect(body.server.tools).toEqual([]);
    expect(body.server).not.toHaveProperty("credential");
    expect(body.server).not.toHaveProperty("credentialEnc");
    expect(JSON.stringify(body)).not.toContain(credential);

    const stored = await collections.servers.findOne({ slug: "credential-server" });
    expect(stored?.credentialEnc).toBeDefined();
    expect(stored?.credentialEnc).not.toBe(credential);
    expect(decryptCredential(stored?.credentialEnc as string, Buffer.alloc(32, 7).toString("base64"))).toBe(credential);

    const listed = await fetch(`${baseUrl}/api/servers`, {
      headers: { cookie: sessionCookie(memberId) },
    });
    const listedBody = await listed.json() as { servers: Array<Record<string, unknown>> };
    expect(JSON.stringify(listedBody)).not.toContain(credential);
    expect(JSON.stringify(listedBody)).not.toContain("credentialEnc");
    expect(listedBody.servers.some((entry) => entry.slug === "credential-server" && entry.hasCredential === true)).toBe(true);
  });

  it("returns 409 for duplicate server slugs", async () => {
    const request = () => fetch(`${baseUrl}/api/servers`, {
      method: "POST",
      headers: { cookie: sessionCookie(adminId), "content-type": "application/json" },
      body: JSON.stringify({
        slug: "duplicate-server",
        name: "Duplicate test",
        url: "http://woo-mcp:3001/mcp",
        authType: "none",
      }),
    });
    expect((await request()).status).toBe(201);
    expect((await request()).status).toBe(409);
  });

  it("rejects immutable slug updates and none-to-bearer without a credential", async () => {
    const created = await fetch(`${baseUrl}/api/servers`, {
      method: "POST",
      headers: { cookie: sessionCookie(adminId), "content-type": "application/json" },
      body: JSON.stringify({
        slug: "immutable-server",
        name: "Immutable test",
        url: "http://woo-mcp:3001/mcp",
        authType: "none",
      }),
    });
    expect(created.status).toBe(201);
    const { server: createdServer } = await created.json() as { server: { id: string } };

    const changeSlug = await fetch(`${baseUrl}/api/servers/${createdServer.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie(adminId), "content-type": "application/json" },
      body: JSON.stringify({ slug: "changed-server" }),
    });
    expect(changeSlug.status).toBe(400);

    const missingCredential = await fetch(`${baseUrl}/api/servers/${createdServer.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie(adminId), "content-type": "application/json" },
      body: JSON.stringify({ authType: "bearer" }),
    });
    expect(missingCredential.status).toBe(400);

    const unchanged = await collections.servers.findOne({ _id: new ObjectId(createdServer.id) });
    expect(unchanged?.slug).toBe("immutable-server");
    expect(unchanged?.authType).toBe("none");
  });

  it("clears credential and headerName when changing header auth to none", async () => {
    const credential = "header-credential-test-only";
    const created = await fetch(`${baseUrl}/api/servers`, {
      method: "POST",
      headers: { cookie: sessionCookie(adminId), "content-type": "application/json" },
      body: JSON.stringify({
        slug: "clear-credential",
        name: "Clear credential test",
        url: "http://woo-mcp:3001/mcp",
        authType: "header",
        headerName: "X-Upstream-Token",
        credential,
      }),
    });
    expect(created.status).toBe(201);
    const { server: createdServer } = await created.json() as { server: { id: string } };

    const response = await fetch(`${baseUrl}/api/servers/${createdServer.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie(adminId), "content-type": "application/json" },
      body: JSON.stringify({ authType: "none" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { server: Record<string, unknown> };
    expect(body.server.authType).toBe("none");
    expect(body.server.hasCredential).toBe(false);
    expect(body.server).not.toHaveProperty("headerName");
    expect(body.server).not.toHaveProperty("credentialEnc");
    expect(JSON.stringify(body)).not.toContain(credential);

    const stored = await collections.servers.findOne({ _id: new ObjectId(createdServer.id) });
    expect(stored?.credentialEnc).toBeUndefined();
    expect(stored?.headerName).toBeUndefined();
  });

  it("requires a session to read audit entries", async () => {
    const response = await fetch(`${baseUrl}/api/audit`);
    expect(response.status).toBe(401);
  });

  it.each(["0", "101", "1.5", "nope"])("rejects invalid audit limit %s", async (limit) => {
    const response = await fetch(`${baseUrl}/api/audit?limit=${encodeURIComponent(limit)}`, {
      headers: { cookie: sessionCookie(adminId) },
    });
    expect(response.status).toBe(400);
  });

  it("does not let a member widen audit scope using userId and cursor together", async () => {
    const response = await fetch(
      `${baseUrl}/api/audit?userId=${adminId.toHexString()}&cursor=tampered`,
      { headers: { cookie: sessionCookie(memberId) } },
    );
    expect(response.status).toBe(403);
  });

  it("returns a paginated audit response and redacts unexpected credential fields", async () => {
    auditDocuments.length = 0;
    auditDocuments.push({
      _id: new ObjectId("00000000000000000000000a"),
      ts: new Date("2026-10-19T12:00:00.000Z"),
      userId: memberId,
      userEmail: "member@example.com",
      source: "mcp",
      serverSlug: "woo",
      toolName: "list_products",
      durationMs: 12,
      outcome: "success",
      argsHash: "a".repeat(64),
      credential: "sentinel-upstream-credential-never-return",
    } as AuditLogDocument);

    const response = await fetch(`${baseUrl}/api/audit`, {
      headers: { cookie: sessionCookie(adminId) },
    });
    expect(response.status).toBe(200);
    const json = await response.json() as {
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    };
    expect(json.items).toHaveLength(1);
    expect(json.nextCursor).toBeNull();
    expect(JSON.stringify(json)).not.toContain("sentinel-upstream-credential-never-return");
    expect(JSON.stringify(json)).not.toContain("credentialEnc");
    expect(JSON.stringify(json)).not.toContain("argsHash");
  });

  it("returns 400 for a tampered audit cursor", async () => {
    const response = await fetch(`${baseUrl}/api/audit?cursor=not-a-signed-cursor`, {
      headers: { cookie: sessionCookie(adminId) },
    });
    expect(response.status).toBe(400);
  });

  it("requires a session to list API keys", async () => {
    const response = await fetch(`${baseUrl}/api/keys`);

    expect(response.status).toBe(401);
  });

  it("lists a member's own key metadata without its hash or full secret", async () => {
    const created = await createUserApiKey(
      collections.apikeys,
      memberId,
      "HTTP test member key",
    );

    const response = await fetch(`${baseUrl}/api/keys`, {
      headers: { cookie: sessionCookie(memberId) },
    });

    expect(response.status).toBe(200);

    const body = await response.json() as {
      keys: Array<Record<string, unknown>>;
    };
    const row = body.keys.find(
      (entry) => entry.id === created.apiKey.id,
    );

    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("hash");
    expect(JSON.stringify(body)).not.toContain(created.key);
  });

  it("prevents a member from listing another user's API keys", async () => {
    const response = await fetch(
      `${baseUrl}/api/keys?userId=${adminId.toHexString()}`,
      { headers: { cookie: sessionCookie(memberId) } },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("allows an admin to list a selected member's keys", async () => {
    const created = await createUserApiKey(
      collections.apikeys,
      memberId,
      "Admin lookup test key",
    );

    const response = await fetch(
      `${baseUrl}/api/keys?userId=${memberId.toHexString()}`,
      { headers: { cookie: sessionCookie(adminId) } },
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      keys: Array<Record<string, unknown>>;
    };

    expect(
      body.keys.some((entry) => entry.id === created.apiKey.id),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain(created.key);
  });

  it("revokes a member's own key and rejects it immediately", async () => {
    const created = await createUserApiKey(
      collections.apikeys,
      memberId,
      "HTTP revocation test key",
    );

    const response = await fetch(
      `${baseUrl}/api/keys/${created.apiKey.id}`,
      {
        method: "DELETE",
        headers: {
          cookie: sessionCookie(memberId),
          "content-type": "application/json",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "revoked" });
    await expect(
      findActiveApiKey(collections.apikeys, created.key),
    ).resolves.toBeNull();
  });

  it("does not let a member revoke another user's key", async () => {
    const created = await createUserApiKey(
      collections.apikeys,
      adminId,
      "Protected admin key",
    );

    const response = await fetch(
      `${baseUrl}/api/keys/${created.apiKey.id}`,
      {
        method: "DELETE",
        headers: {
          cookie: sessionCookie(memberId),
          "content-type": "application/json",
        },
      },
    );

    expect(response.status).toBe(404);
    await expect(
      findActiveApiKey(collections.apikeys, created.key),
    ).resolves.not.toBeNull();
  });

  it("allows an admin to revoke another user's key", async () => {
    const created = await createUserApiKey(
      collections.apikeys,
      memberId,
      "Admin revocation test key",
    );

    const response = await fetch(
      `${baseUrl}/api/keys/${created.apiKey.id}`,
      {
        method: "DELETE",
        headers: {
          cookie: sessionCookie(adminId),
          "content-type": "application/json",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(
      findActiveApiKey(collections.apikeys, created.key),
    ).resolves.toBeNull();
  });
});


describe("MCP endpoint authentication", () => {
  async function postMcp(authorization?: string) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (authorization !== undefined) {
      headers.authorization = authorization;
    }

    return fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
  }

  it("returns 401 when the client omits its API key", async () => {
    const response = await postMcp();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Unauthorized" },
    });
  });

  it("returns 401 for malformed and unknown API keys", async () => {
    const malformed = await postMcp("Bearer not-a-valid-key");
    expect(malformed.status).toBe(401);

    const unknown = await postMcp(`Bearer urumi_abcdefgh_${"A".repeat(43)}`);
    expect(unknown.status).toBe(401);
  });

  it("returns 401 for a revoked API key", async () => {
    const created = await createUserApiKey(
      collections.apikeys,
      memberId,
      "MCP revoked-key test",
    );

    const revokeResponse = await fetch(
      `${baseUrl}/api/keys/${created.apiKey.id}`,
      {
        method: "DELETE",
        headers: {
          cookie: sessionCookie(memberId),
          "content-type": "application/json",
        },
      },
    );
    expect(revokeResponse.status).toBe(200);

    const response = await postMcp(`Bearer ${created.key}`);
    expect(response.status).toBe(401);
  });

  it("returns 401 when the API key belongs to a disabled user", async () => {
    const created = await createUserApiKey(
      collections.apikeys,
      disabledId,
      "MCP disabled-user test",
    );

    const response = await postMcp(`Bearer ${created.key}`);
    expect(response.status).toBe(401);
  });

  it("supports initialize and tools/list for a valid active member key", async () => {
    const created = await createUserApiKey(
      collections.apikeys,
      memberId,
      "MCP valid-member test",
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${created.key}` },
        },
      },
    );

    const client = new Client(
      { name: "urumi-gateway-http-test", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      await client.connect(transport, { timeout: 5_000 });
      const result = await client.listTools({}, { timeout: 5_000 });

      // The fixture has no connected upstream servers.
      expect(result.tools).toEqual([]);
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  });
});


describe("server tool metadata HTTP response", () => {
  it("exposes discovered tool metadata and clears it when disabled or unreachable", async () => {
    const upstream: ServerDocument = {
      _id: new ObjectId(),
      slug: "cache-test",
      name: "Cache test upstream",
      url: "http://cache-test.invalid/mcp",
      authType: "none",
      enabled: true,
      status: "connected",
      createdAt: new Date(),
    };

    await collections.servers.insertOne(upstream);

    const createdKey = await createUserApiKey(
      collections.apikeys,
      adminId,
      "server metadata integration test",
    );

    const fetchServer = async () => {
      const response = await fetch(`${baseUrl}/api/servers`, {
        headers: { cookie: sessionCookie(adminId) },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        servers: Array<{
          id: string;
          slug: string;
          status: string;
          enabled: boolean;
          toolCount: number;
          tools: Array<{ name: string; description: string }>;
        }>;
      };

      const result = body.servers.find((server) => server.slug === upstream.slug);
      expect(result).toBeDefined();
      return result!;
    };

    const listMcpTools = async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`${baseUrl}/mcp`),
        {
          requestInit: {
            headers: { Authorization: `Bearer ${createdKey.key}` },
          },
        },
      );
      const client = new Client(
        { name: "server-metadata-test", version: "1.0.0" },
        { capabilities: {} },
      );

      try {
        await client.connect(transport, { timeout: 5_000 });
        return (await client.listTools({}, { timeout: 5_000 })).tools;
      } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      }
    };

    try {
      // Cold cache should be empty before discovery happens.
      const cold = await fetchServer();
      expect(cold.toolCount).toBe(0);
      expect(cold.tools).toEqual([]);

      const discovered = await listMcpTools();
      expect(discovered.map((tool) => tool.name)).toContain(
        "cache-test__echo",
      );

      const healthy = await fetchServer();
      expect(healthy.status).toBe("connected");
      expect(healthy.toolCount).toBe(1);
      expect(healthy.tools).toEqual([
        {
          name: "cache-test__echo",
          description: "[cache-test] Echo test tool",
        },
      ]);

      // Cached metadata is filtered for members, not just for MCP clients.
      const memberResponse = await fetch(`${baseUrl}/api/servers`, {
        headers: { cookie: sessionCookie(memberId) },
      });
      expect(memberResponse.status).toBe(200);

      const memberBody = await memberResponse.json() as {
        servers: Array<{
          slug: string;
          toolCount: number;
          tools: Array<{ name: string; description: string }>;
        }>;
      };

      const memberServer = memberBody.servers.find(
        (entry) => entry.slug === upstream.slug,
      );

      expect(memberServer).toBeDefined();
      expect(memberServer?.toolCount).toBe(0);
      expect(memberServer?.tools).toEqual([]);

      // Disabling through the real REST route must remove old metadata.
      const disabledResponse = await fetch(
        `${baseUrl}/api/servers/${upstream._id.toHexString()}`,
        {
          method: "PATCH",
          headers: {
            cookie: sessionCookie(adminId),
            "content-type": "application/json",
          },
          body: JSON.stringify({ enabled: false }),
        },
      );

      expect(disabledResponse.status).toBe(200);
      const disabledBody = await disabledResponse.json() as {
        server: { status: string; toolCount: number; tools: unknown[] };
      };
      expect(disabledBody.server.status).toBe("disabled");
      expect(disabledBody.server.toolCount).toBe(0);
      expect(disabledBody.server.tools).toEqual([]);

      // Simulate an enabled server whose previously healthy discovery now fails.
      const enabledResponse = await fetch(
        `${baseUrl}/api/servers/${upstream._id.toHexString()}`,
        {
          method: "PATCH",
          headers: {
            cookie: sessionCookie(adminId),
            "content-type": "application/json",
          },
          body: JSON.stringify({ enabled: true }),
        },
      );
      expect(enabledResponse.status).toBe(200);

      // Represent a previously successful health check; the next discovery fails.
      upstream.status = "connected";
      failingDiscoverySlug = upstream.slug;

      const failedDiscovery = await listMcpTools();
      expect(failedDiscovery.map((tool) => tool.name)).not.toContain(
        "cache-test__echo",
      );

      const unreachable = await fetchServer();
      expect(unreachable.status).toBe("unreachable");
      expect(unreachable.toolCount).toBe(0);
      expect(unreachable.tools).toEqual([]);
    } finally {
      failingDiscoverySlug = null;

      const revoke = await fetch(
        `${baseUrl}/api/keys/${createdKey.apiKey.id}`,
        {
          method: "DELETE",
          headers: {
            cookie: sessionCookie(adminId),
            "content-type": "application/json",
          },
        },
      );
      expect(revoke.status).toBe(200);
    }
  });
});


describe("chat HTTP route integration", () => {
  it("uses the authenticated user, exposes only eligible tools, and audits real tool calls", async () => {
    const envSnapshot = {
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
    };
    const originalFailingDiscoverySlug = failingDiscoverySlug;
    const originalServerLength = serverDocuments.length;
    const originalServerStates = serverDocuments.map((document) => ({
      document,
      enabled: document.enabled,
      status: document.status,
    }));

    // Synthetic test-only credential. Never print or persist it.
    const testApiKey = ["fake", "chat", "key", "route"].join("-");
    const providerRequests: Array<{
      authorization: string | undefined;
      path: string;
      payload: {
        messages?: Array<{ role?: string; content?: unknown }>;
        tools?: Array<{ function?: { name?: string } }>;
      };
    }> = [];
    const providerErrors: unknown[] = [];

    const provider = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.from(chunk));
        }

        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          messages?: Array<{ role?: string; content?: unknown }>;
          tools?: Array<{ function?: { name?: string } }>;
        };

        providerRequests.push({
          authorization: request.headers.authorization,
          path: request.url ?? "",
          payload,
        });

        const hasToolResult = payload.messages?.some(
          (message) => message.role === "tool",
        ) ?? false;

        const completion = hasToolResult
          ? {
              choices: [{
                message: {
                  role: "assistant",
                  content: "The test tool found the requested result.",
                },
              }],
            }
          : {
              choices: [{
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{
                    id: "test-call-1",
                    type: "function",
                    function: {
                      name: "testchat__echo",
                      arguments: JSON.stringify({ message: "hello" }),
                    },
                  }],
                },
              }],
            };

        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(completion));
      } catch (error: unknown) {
        providerErrors.push(error);
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "synthetic provider failure" }));
      }
    });

    const makeServerDocument = (
      slug: string,
      enabled: boolean,
      status: ServerDocument["status"],
    ): ServerDocument => ({
      _id: new ObjectId(),
      slug,
      name: `Chat integration ${slug}`,
      url: "http://127.0.0.1:65535/mcp",
      authType: "none",
      enabled,
      status,
      createdAt: new Date(),
    } as ServerDocument);

    try {
      // Keep unrelated fixtures from affecting this test's tool list.
      for (const document of serverDocuments) {
        document.enabled = false;
        document.status = "disabled";
      }

      serverDocuments.push(
        makeServerDocument("testchat", true, "connected"),
        makeServerDocument("disabledchat", false, "disabled"),
        makeServerDocument("offlinechat", true, "unreachable"),
      );
      failingDiscoverySlug = null;

      await new Promise<void>((resolve, reject) => {
        provider.once("error", reject);
        provider.listen(0, "127.0.0.1", () => {
          provider.off("error", reject);
          resolve();
        });
      });

      const address = provider.address();
      if (!address || typeof address === "string") {
        throw new Error("Fake chat provider did not bind to a TCP port");
      }

      process.env.LLM_PROVIDER = "openai-compatible";
      process.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1/`;
      process.env.LLM_API_KEY = testApiKey;
      process.env.LLM_MODEL = "synthetic-test-model";

      const auditStart = auditDocuments.length;
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          cookie: sessionCookie(adminId),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Find today's order." }],
        }),
      });

      const body = await response.json() as {
        reply: string;
        toolCalls: Array<{
          server: string;
          tool: string;
          ok: boolean;
          durationMs: number;
        }>;
      };

      expect(response.status).toBe(200);
      expect(body.reply).toBe("The test tool found the requested result.");
      expect(body.toolCalls).toHaveLength(1);
      expect(body.toolCalls[0]).toMatchObject({
        server: "testchat",
        tool: "echo",
        ok: true,
      });
      expect(body.toolCalls[0]?.durationMs).toEqual(expect.any(Number));

      // The provider receives only enabled, connected tools.
      expect(providerRequests).toHaveLength(2);
      expect(providerErrors).toHaveLength(0);
      expect(providerRequests.map((item) => item.path)).toEqual([
        "/v1/chat/completions",
        "/v1/chat/completions",
      ]);
      expect(providerRequests.every(
        (item) => item.authorization === `Bearer ${testApiKey}`,
      )).toBe(true);

      const exposedNames = providerRequests[0]?.payload.tools?.map(
        (tool) => tool.function?.name,
      );
      expect(exposedNames).toContain("testchat__echo");
      expect(exposedNames).not.toContain("disabledchat__echo");
      expect(exposedNames).not.toContain("offlinechat__echo");

      // The response includes summaries, not tool arguments or raw results.
      const publicResponse = JSON.stringify(body);
      expect(publicResponse).not.toContain("test result");
      expect(publicResponse).not.toContain('"message":"hello"');

      // This assertion exercises the actual GatewayAggregator and audit writer.
      const newAuditRows = auditDocuments.slice(auditStart);
      expect(newAuditRows).toHaveLength(1);
      expect(newAuditRows[0]?.source).toBe("chat");
      expect(newAuditRows[0]?.userId.equals(adminId)).toBe(true);
      expect(newAuditRows[0]?.userEmail).toBe("admin@example.com");
      expect(newAuditRows[0]?.serverSlug).toBe("testchat");
      expect(newAuditRows[0]?.toolName).toBe("echo");
      expect(newAuditRows[0]?.outcome).toBe("success");
    } finally {
      for (const [name, value] of Object.entries(envSnapshot)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }

      failingDiscoverySlug = originalFailingDiscoverySlug;
      serverDocuments.splice(originalServerLength);
      for (const state of originalServerStates) {
        state.document.enabled = state.enabled;
        state.document.status = state.status;
      }

      if (provider.listening) {
        await new Promise<void>((resolve, reject) => {
          provider.close((error) => error ? reject(error) : resolve());
        });
      }
    }
  });

  it("rejects a client-supplied identity instead of allowing user spoofing", async () => {
    const auditStart = auditDocuments.length;

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        cookie: sessionCookie(memberId),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Show my orders." }],
        userId: adminId.toHexString(),
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_chat_request" },
    });
    expect(auditDocuments).toHaveLength(auditStart);
  });

  it("rejects chat requests without an authenticated session", async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Show my orders." }],
      }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthenticated" },
    });
  });
});
