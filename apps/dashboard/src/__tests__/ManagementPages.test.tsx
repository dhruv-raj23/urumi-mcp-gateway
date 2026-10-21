import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  AcceptInvitePage,
  AuditPage,
  ChatPage,
  KeysPage,
  MembersPage,
} from "../ManagementPages";

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

const currentUser = {
  id: "64a000000000000000000001",
  email: "admin@example.com",
  role: "admin" as const,
};

const member = {
  id: "64a000000000000000000002",
  email: "testuser@example.com",
  role: "member" as const,
  status: "active" as const,
  createdAt: "2026-10-21T07:00:00.000Z",
};

const activeKey = {
  id: "64a000000000000000000003",
  name: "Temporary test key",
  prefix: "urumi_abcd1234",
  createdAt: "2026-10-21T07:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

const fetchMock = vi.fn(
  async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> => jsonResponse({}, 404),
);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse({}, 404));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("chat integration point", () => {
  it("clearly marks the chat agent as planned for T07", () => {
    render(<ChatPage />);

    expect(screen.getByRole("heading", { name: "Chat with your tools" }))
      .toBeInTheDocument();
    expect(screen.getByText("Coming in T07")).toBeInTheDocument();
    expect(screen.getByText(/will be connected in T07/i)).toBeInTheDocument();
  });
});

describe("dashboard invitation flows", () => {
  it("creates an invitation and displays the one-time link", async () => {
    const user = userEvent.setup();
    const invitationToken = ["test", "invitation", "token"].join("-");

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/users" && !init?.method) {
        return jsonResponse({ users: [member] });
      }

      if (url === "/api/users/invite" && init?.method === "POST") {
        return jsonResponse({
          invitation: {
            id: "64a000000000000000000004",
            email: "newmember@example.com",
            role: "member",
            status: "invited",
            expiresAt: "2026-10-22T07:00:00.000Z",
          },
          token: invitationToken,
        }, 201);
      }

      return jsonResponse({}, 404);
    });

    render(<MembersPage />);

    await screen.findByText("testuser@example.com");
    await user.type(
      screen.getByLabelText("Email address"),
      "newmember@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    const link = await screen.findByLabelText("Invitation link");
    expect(link).toHaveValue(
      `${window.location.origin}/invite/${invitationToken}`,
    );
    expect(screen.getByText(/TOKEN SHOWN ONCE/)).toBeInTheDocument();

    const inviteCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === "/api/users/invite",
    );
    expect(inviteCall).toBeDefined();
    expect(JSON.parse(String(inviteCall?.[1]?.body))).toEqual({
      email: "newmember@example.com",
      role: "member",
    });
  });

  it("accepts a valid invitation using the documented API contract", async () => {
    const user = userEvent.setup();
    const invitationToken = ["single", "use", "invite", "token"].join("-");
    const passphrase = ["Strong", "Test", "Password", "123"].join("-");
    fetchMock.mockResolvedValue(jsonResponse({ status: "accepted" }));

    render(<AcceptInvitePage token={invitationToken} />);

    await user.type(screen.getByLabelText("Password"), passphrase);
    await user.type(screen.getByLabelText("Confirm password"), passphrase);
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    expect(await screen.findByText("You're all set")).toBeInTheDocument();

    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toBe("/api/auth/accept-invite");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      token: invitationToken,
      password: passphrase,
    });
  });
});

describe("member disablement", () => {
  const adminRecord = {
    ...currentUser,
    status: "active" as const,
    createdAt: "2026-10-21T06:00:00.000Z",
  };

  it("disables a member after confirmation and updates the row", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url === "/api/users" && method === "GET") {
        return jsonResponse({ users: [adminRecord, member] });
      }

      if (url === `/api/users/${member.id}` && method === "PATCH") {
        return jsonResponse({ user: { ...member, status: "disabled" } });
      }

      return jsonResponse({}, 404);
    });

    render(<MembersPage />);
    await screen.findByText(member.email);

    const adminRow = screen.getByRole("row", {
      name: new RegExp(currentUser.email),
    });
    expect(within(adminRow).queryByRole("button", { name: "Disable" }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Disable" }));

    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByText("disabled")).toBeInTheDocument();
    });

    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === `/api/users/${member.id}` &&
        (init?.method ?? "").toUpperCase() === "PATCH",
    );

    expect(patchCall).toBeDefined();
    expect(new Headers(patchCall?.[1]?.headers).get("Content-Type"))
      .toBe("application/json");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      status: "disabled",
    });
  });

  it("shows an error and preserves active status when disabling fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url === "/api/users" && method === "GET") {
        return jsonResponse({ users: [member] });
      }

      if (url === `/api/users/${member.id}` && method === "PATCH") {
        return jsonResponse({
          error: {
            code: "forbidden",
            message: "Administrator access required",
          },
        }, 403);
      }

      return jsonResponse({}, 404);
    });

    render(<MembersPage />);
    await screen.findByText(member.email);
    await user.click(screen.getByRole("button", { name: "Disable" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Administrator access required",
    );
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("does not offer a disable action for already-disabled members", async () => {
    const disabledMember = { ...member, status: "disabled" as const };

    fetchMock.mockResolvedValue(
      jsonResponse({ users: [adminRecord, disabledMember] }),
    );

    render(<MembersPage />);
    await screen.findByText(disabledMember.email);

    expect(screen.queryByRole("button", { name: "Disable" }))
      .not.toBeInTheDocument();
  });
});

describe("API key management", () => {
  it("sends JSON Content-Type on DELETE and updates the key after successful revocation", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url === "/api/users" && method === "GET") {
        return jsonResponse({ users: [currentUser, member] });
      }

      if (url.startsWith("/api/keys") && method === "GET") {
        return jsonResponse({ keys: [activeKey] });
      }

      if (url === `/api/keys/${activeKey.id}` && method === "DELETE") {
        return jsonResponse({ status: "revoked" });
      }

      return jsonResponse({}, 404);
    });

    render(<KeysPage currentUser={currentUser} />);

    await screen.findByText("Temporary test key");
    expect(screen.getByText("active")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(screen.getByText("revoked")).toBeInTheDocument();
    });

    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();

    const deleteCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === `/api/keys/${activeKey.id}` &&
        (init?.method ?? "").toUpperCase() === "DELETE",
    );

    expect(deleteCall).toBeDefined();
    expect(new Headers(deleteCall?.[1]?.headers).get("Content-Type"))
      .toBe("application/json");
  });
});

describe("audit log", () => {
  it("shows the signed-in member's returned audit entries without widening scope", async () => {
    const memberUser = {
      id: member.id,
      email: member.email,
      role: "member" as const,
    };

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.startsWith("/api/audit?")) {
        return jsonResponse({
          items: [{
            id: "64a000000000000000000005",
            ts: "2026-10-21T08:00:00.000Z",
            userId: member.id,
            userEmail: member.email,
            source: "mcp",
            serverSlug: "woo",
            toolName: "list_orders",
            durationMs: 85,
            outcome: "success",
          }],
          nextCursor: null,
        });
      }

      return jsonResponse({}, 404);
    });

    render(<AuditPage currentUser={memberUser} />);

    expect(await screen.findByText("list_orders")).toBeInTheDocument();
    expect(screen.getByText("85 ms")).toBeInTheDocument();

    const auditCalls = fetchMock.mock.calls.filter(
      ([input]) => String(input).startsWith("/api/audit?"),
    );

    expect(auditCalls.length).toBeGreaterThan(0);

    for (const [input] of auditCalls) {
      const url = new URL(String(input), window.location.origin);
      expect(url.searchParams.has("userId")).toBe(false);
    }
  });
});
