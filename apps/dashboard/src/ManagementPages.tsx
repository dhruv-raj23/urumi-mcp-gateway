import { useEffect, useState, type FormEvent } from "react";

type Role = "admin" | "member";
type Outcome = "success" | "error" | "timeout" | "denied";

interface CurrentUser {
  id: string;
  email: string;
  role: Role;
}

interface MemberRecord {
  id: string;
  email: string;
  role: Role;
  status: "invited" | "active" | "disabled";
  createdAt: string;
}

interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

interface AuditRecord {
  id: string;
  ts: string;
  userId: string;
  userEmail: string;
  source: "mcp" | "chat";
  serverSlug: string;
  toolName: string;
  durationMs: number;
  outcome: Outcome;
  errorMessage?: string;
}

interface ApiErrorBody {
  error?: { message?: string };
  message?: string;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  const method = (options.method ?? "GET").toUpperCase();
  const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  // The gateway requires JSON Content-Type on state-changing API requests,
  // including DELETE requests that intentionally have no body.
  if (isStateChanging && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });

  const text = await response.text();
  let payload: unknown;

  try {
    payload = text ? JSON.parse(text) as unknown : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new Error(
      body?.error?.message ??
      body?.message ??
      `Request failed with status ${response.status}`,
    );
  }

  return payload as T;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function dateTime(value: string | undefined | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone =
    normalized === "active" || normalized === "success" ? "good" :
    normalized === "error" || normalized === "denied" ||
    normalized === "disabled" ? "bad" :
    normalized === "timeout" || normalized === "invited" ? "warn" : "neutral";

  return <span className={`management-pill pill-${tone}`}>{value}</span>;
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button className="button button-secondary button-small" type="button" onClick={() => void copy()}>
      {copied ? "Copied" : label}
    </button>
  );
}

export function MembersPage() {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [reload, setReload] = useState(0);
  const [invitation, setInvitation] = useState<{
    email: string;
    role: Role;
    token: string;
    expiresAt: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    request<{ users: MemberRecord[] }>("/api/users")
      .then((result) => {
        if (active) {
          setMembers(result.users);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(messageOf(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [reload]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setInvitation(null);

    try {
      const result = await request<{
        invitation: {
          email: string;
          role: Role;
          expiresAt: string;
        };
        token: string;
      }>("/api/users/invite", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role }),
      });

      // Keep the plaintext token only in component memory for this session.
      // It is never written to localStorage, sessionStorage, or a cookie.
      setInvitation({
        email: result.invitation.email,
        role: result.invitation.role,
        token: result.token,
        expiresAt: result.invitation.expiresAt,
      });
      setEmail("");
      setLoading(true);
      setError("");
      setReload((value) => value + 1);
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function disableMember(member: MemberRecord) {
    const confirmed = window.confirm(
      `Disable ${member.email}? They will lose access immediately.`,
    );
    if (!confirmed) return;

    setDisablingId(member.id);
    setError("");

    try {
      const result = await request<{ user: MemberRecord }>(
        `/api/users/${encodeURIComponent(member.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "disabled" }),
        },
      );

      setMembers((current) =>
        current.map((entry) =>
          entry.id === result.user.id ? result.user : entry
        ),
      );
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      setDisablingId(null);
    }
  }

  const invitationLink = invitation
    ? `${window.location.origin}/invite/${encodeURIComponent(invitation.token)}`
    : "";

  return (
    <section className="management-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ACCESS CONTROL</p>
          <h1>Team members</h1>
          <p className="muted">Invite teammates and review their account status.</p>
        </div>
        <span className="count-pill">{members.length} accounts</span>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="management-panel">
        <div className="management-panel-heading">
          <div>
            <h2>Invite a member</h2>
            <p className="muted small">An invitation expires after 24 hours and can be used once.</p>
          </div>
        </div>
        <form className="management-form invite-form" onSubmit={(event) => void invite(event)}>
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@company.com"
              required
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              <option value="member">Team member</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <button className="button button-primary" disabled={busy}>
            {busy ? "Creating invitation…" : "Create invitation"}
          </button>
        </form>

        {invitation && (
          <div className="invitation-result">
            <div>
              <p className="eyebrow">INVITATION CREATED — TOKEN SHOWN ONCE</p>
              <h3>{invitation.email}</h3>
              <p className="muted small">
                Role: {invitation.role}. Expires: {dateTime(invitation.expiresAt)}.
                Share this link securely with the invited person.
              </p>
            </div>
            <label className="field">
              <span>Invitation link</span>
              <input readOnly value={invitationLink} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div className="management-actions">
              <CopyButton value={invitationLink} label="Copy invitation link" />
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => setInvitation(null)}
              >
                Hide token
              </button>
            </div>
            <p className="muted small">
              The plaintext token is kept only in page memory. If you hide it or
              reload, this screen will not reveal it again.
            </p>
          </div>
        )}
      </section>

      <section className="management-panel">
        <div className="management-panel-heading">
          <div>
            <h2>Directory</h2>
            <p className="muted small">Account status from the gateway.</p>
          </div>
          <button
            className="button button-secondary button-small"
            onClick={() => {
              setLoading(true);
              setError("");
              setReload((value) => value + 1);
            }}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="muted">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="muted">No accounts found.</p>
        ) : (
          <div className="management-table-wrap">
            <table className="management-table">
              <thead>
                <tr><th>Member</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <strong>{member.email}</strong>
                      <small>{member.id}</small>
                    </td>
                    <td>{member.role}</td>
                    <td><StatusPill value={member.status} /></td>
                    <td>{dateTime(member.createdAt)}</td>
                    <td>
                      {member.role === "member" && member.status !== "disabled" ? (
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          disabled={disablingId !== null}
                          onClick={() => void disableMember(member)}
                        >
                          {disablingId === member.id ? "Disabling…" : "Disable"}
                        </button>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

export function ChatPage() {
  return (
    <section className="management-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ASSISTED WORKFLOWS</p>
          <h1>Chat with your tools</h1>
          <p className="muted">
            Ask questions across the tools exposed by your connected MCP servers.
          </p>
        </div>
        <span className="count-pill">Coming in T07</span>
      </div>
      <section className="management-panel">
        <h2>Chat agent integration point</h2>
        <p className="muted">
          The chat agent will be connected in T07. Tool discovery and execution
          will go through the gateway, using the signed-in user's permissions
          and the existing audit path.
        </p>
      </section>
    </section>
  );
}

export function AcceptInvitePage({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    if (new TextEncoder().encode(password).length > 72) {
      setError("Password must be no more than 72 UTF-8 bytes.");
      return;
    }

    setBusy(true);
    try {
      await request("/api/auth/accept-invite", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setComplete(true);
      setPassword("");
      setConfirmPassword("");
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-layout invite-accept-layout">
      <section className="login-brand-panel">
        <div className="brand brand-large">
          <span className="brand-mark">U</span>
          <span>urumi<span className="brand-light">/</span>gateway</span>
        </div>
        <div className="login-pitch">
          <p className="eyebrow">TEAM INVITATION</p>
          <h1>Join your workspace.</h1>
          <p className="muted">Set a password to activate your gateway account.</p>
        </div>
        <p className="panel-footnote">Your access is managed by your workspace administrator.</p>
      </section>
      <section className="login-form-panel">
        <div className="login-card">
          <p className="eyebrow">ACCOUNT ACTIVATION</p>
          <h2>{complete ? "You're all set" : "Create your password"}</h2>
          {complete ? (
            <>
              <p className="muted">Your invitation was accepted. You can now sign in.</p>
              <a className="button button-primary button-wide invite-login-link" href="/">Continue to sign in →</a>
            </>
          ) : (
            <form onSubmit={(event) => void accept(event)}>
              <p className="muted">Use at least 12 characters. This invitation can be accepted once.</p>
              {error && <div className="alert alert-error" role="alert">{error}</div>}
              <label className="field">
                <span>Password</span>
                <input type="password" autoComplete="new-password" minLength={12}
                  maxLength={72} value={password}
                  onChange={(event) => setPassword(event.target.value)} required />
              </label>
              <label className="field">
                <span>Confirm password</span>
                <input type="password" autoComplete="new-password" minLength={12}
                  maxLength={72} value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)} required />
              </label>
              <button className="button button-primary button-wide" disabled={busy}>
                {busy ? "Activating account…" : "Accept invitation"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

export function KeysPage({ currentUser }: { currentUser: CurrentUser }) {
  const isAdmin = currentUser.role === "admin";
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(currentUser.id);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState("");
  const [revealedKey, setRevealedKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    request<{ users: MemberRecord[] }>("/api/users")
      .then((result) => {
        if (active) {
          setMembers(result.users);
          if (!selectedUserId && result.users[0]) {
            setSelectedUserId(result.users[0].id);
          }
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(messageOf(cause));
      });
    return () => { active = false; };
  }, [isAdmin, selectedUserId]);

  useEffect(() => {
    let active = true;
    const query = isAdmin && selectedUserId
      ? `?userId=${encodeURIComponent(selectedUserId)}`
      : "";

    request<{ keys: ApiKeyRecord[] }>(`/api/keys${query}`)
      .then((result) => {
        if (active) {
          setKeys(result.keys);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(messageOf(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [isAdmin, selectedUserId, reload]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setRevealedKey("");

    try {
      const result = await request<{
        key: string;
        apiKey: ApiKeyRecord;
      }>("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });

      // The API intentionally returns the secret only once. Keep it only in
      // this page's memory and clear it when hidden or when the page unmounts.
      setRevealedKey(result.key);
      setName("");
      setLoading(true);
      if (isAdmin) setSelectedUserId(currentUser.id);
      setReload((value) => value + 1);
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKeyRecord) {
    if (!window.confirm(`Revoke API key "${key.name}" (${key.prefix})?`)) return;
    setError("");

    try {
      await request(`/api/keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });

      // The backend confirmed revocation. Update the visible row immediately;
      // the next explicit refresh will reconcile it with the persisted API state.
      const revokedAt = new Date().toISOString();
      setKeys((currentKeys) =>
        currentKeys.map((currentKey) =>
          currentKey.id === key.id
            ? { ...currentKey, revokedAt }
            : currentKey,
        ),
      );
      setRevealedKey("");
    } catch (cause: unknown) {
      setError(messageOf(cause));
    }
  }

  return (
    <section className="management-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">GATEWAY ACCESS</p>
          <h1>API keys</h1>
          <p className="muted">Create gateway keys and revoke them when access should end.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="management-panel">
        <h2>Create an API key</h2>
        <p className="muted small">
          A new key always belongs to the signed-in user. Administrators can
          create their own keys here and select another user's keys below to inspect or revoke them.
        </p>
        <form className="management-form create-key-form" onSubmit={(event) => void createKey(event)}>
          <label className="field">
            <span>Key name</span>
            <input value={name} onChange={(event) => setName(event.target.value)}
              placeholder="Claude Code on laptop" minLength={1} maxLength={100} required />
          </label>
          <button className="button button-primary" disabled={busy}>
            {busy ? "Creating key…" : "Create key"}
          </button>
        </form>

        {revealedKey && (
          <div className="secret-result">
            <p className="eyebrow">NEW KEY — SHOWN ONCE</p>
            <p>Copy it now. The gateway stores a hash; the complete key cannot be retrieved later.</p>
            <div className="secret-value">
              <code>{revealedKey}</code>
              <CopyButton value={revealedKey} label="Copy key" />
            </div>
            <button type="button" className="button button-secondary button-small"
              onClick={() => setRevealedKey("")}>Hide key</button>
          </div>
        )}
      </section>

      <section className="management-panel">
        <div className="management-panel-heading">
          <div>
            <h2>{isAdmin ? "Key directory" : "Your keys"}</h2>
            <p className="muted small">Full key material is never shown in this list.</p>
          </div>
          {isAdmin && (
            <label className="compact-field">
              <span>Account</span>
              <select
                value={selectedUserId}
                onChange={(event) => {
                  setLoading(true);
                  setError("");
                  setSelectedUserId(event.target.value);
                }}
              >
                <option value="">My keys</option>
                {members.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.email} {member.id === currentUser.id ? "(you)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {loading ? <p className="muted">Loading API keys…</p> : keys.length === 0 ? (
          <p className="muted">No API keys found for this account.</p>
        ) : (
          <div className="management-table-wrap">
            <table className="management-table">
              <thead>
                <tr><th>Name</th><th>Prefix</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td><strong>{key.name}</strong></td>
                    <td><code>{key.prefix}</code></td>
                    <td>{dateTime(key.createdAt)}</td>
                    <td>{dateTime(key.lastUsedAt)}</td>
                    <td><StatusPill value={key.revokedAt ? "revoked" : "active"} /></td>
                    <td>
                      {!key.revokedAt && (
                        <button type="button" className="button button-danger button-small"
                          onClick={() => void revoke(key)}>Revoke</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

export function AuditPage({ currentUser }: { currentUser: CurrentUser }) {
  const [items, setItems] = useState<AuditRecord[]>([]);
  const [serverFilter, setServerFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  const isAdmin = currentUser.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;

    request<{ users: MemberRecord[] }>("/api/users")
      .then((result) => { if (active) setMembers(result.users); })
      .catch(() => { /* The audit request still reports access or session errors. */ });

    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    let active = true;

    const params = new URLSearchParams({ limit: "50" });
    if (serverFilter.trim()) params.set("server", serverFilter.trim());
    if (outcomeFilter) params.set("outcome", outcomeFilter);
    if (isAdmin && userFilter) params.set("userId", userFilter);
    if (cursor) params.set("cursor", cursor);

    request<{ items: AuditRecord[]; nextCursor: string | null }>(
      `/api/audit?${params.toString()}`,
    )
      .then((result) => {
        if (active) {
          setItems(result.items);
          setNextCursor(result.nextCursor);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(messageOf(cause));
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [isAdmin, serverFilter, outcomeFilter, userFilter, cursor, reload]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setCursor(null);
    setReload((value) => value + 1);
  }

  return (
    <section className="management-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OBSERVABILITY</p>
          <h1>Audit log</h1>
          <p className="muted">Review tool calls, outcomes, and execution duration.</p>
        </div>
        <button
          className="button button-secondary"
          onClick={() => {
            setLoading(true);
            setError("");
            setReload((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="management-panel">
        <form className="management-form audit-filters" onSubmit={applyFilters}>
          <label className="field">
            <span>Server slug</span>
            <input
              value={serverFilter}
              onChange={(event) => {
                setLoading(true);
                setError("");
                setServerFilter(event.target.value);
              }}
              placeholder="e.g. woo"
              maxLength={24}
            />
          </label>
          <label className="field">
            <span>Outcome</span>
            <select
              value={outcomeFilter}
              onChange={(event) => {
                setLoading(true);
                setError("");
                setOutcomeFilter(event.target.value);
              }}
            >
              <option value="">All outcomes</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="timeout">Timeout</option>
              <option value="denied">Denied</option>
            </select>
          </label>
          {isAdmin && (
            <label className="field">
              <span>Member</span>
              <select
                value={userFilter}
                onChange={(event) => {
                  setLoading(true);
                  setError("");
                  setUserFilter(event.target.value);
                }}
              >
                <option value="">All members</option>
                {members.map((member) => (
                  <option value={member.id} key={member.id}>{member.email}</option>
                ))}
              </select>
            </label>
          )}
          <button className="button button-primary">Apply filters</button>
        </form>

        <div className="audit-scope muted small">
          {isAdmin ? "Administrator view: all users unless filtered." : "Member view: only your own audit entries."}
        </div>

        {loading ? <p className="muted">Loading audit entries…</p> : items.length === 0 ? (
          <p className="muted">No audit entries match these filters.</p>
        ) : (
          <div className="management-table-wrap">
            <table className="management-table audit-table">
              <thead>
                <tr>
                  <th>When</th><th>User</th><th>Server / tool</th>
                  <th>Source</th><th>Duration</th><th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{dateTime(item.ts)}</td>
                    <td>{item.userEmail}</td>
                    <td>
                      <strong>{item.serverSlug}</strong>
                      <small><code>{item.toolName}</code></small>
                      {item.errorMessage && <small className="audit-error">{item.errorMessage}</small>}
                    </td>
                    <td>{item.source}</td>
                    <td>{item.durationMs} ms</td>
                    <td><StatusPill value={item.outcome} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="management-panel-footer">
          <span className="muted small">Showing up to 50 entries per page.</span>
          <button
            type="button"
            className="button button-secondary"
            disabled={!nextCursor || loading}
            onClick={() => setCursor(nextCursor)}
          >
            Next page →
          </button>
        </div>
      </section>
    </section>
  );
}
