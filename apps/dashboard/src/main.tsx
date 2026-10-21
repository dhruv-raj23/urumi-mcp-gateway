import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { AcceptInvitePage, AuditPage, ChatPage, KeysPage, MembersPage } from "./ManagementPages";


type Role = "admin" | "member";
type ServerStatus = "connected" | "unreachable" | "disabled";
type AuthType = "none" | "bearer" | "header";
type DashboardPage = "servers" | "members" | "keys" | "chat" | "audit";

interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

interface ServerTool {
  name: string;
  description: string;
}

interface GatewayServer {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  status: ServerStatus;
  statusReason?: string;
  toolCount: number;
  tools: ServerTool[];
  hasCredential: boolean;
}

interface ApiErrorPayload {
  error?: { message?: string };
  message?: string;
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiRequest<T>(
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

  const responseText = await response.text();
  let payload: unknown = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const body = payload as ApiErrorPayload | null;
    const message =
      body?.error?.message ??
      body?.message ??
      `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readSessionUser(payload: unknown): SessionUser {
  if (!isRecord(payload)) {
    throw new Error("The session endpoint returned an invalid response.");
  }

  const candidate = isRecord(payload.user) ? payload.user : payload;
  const role = candidate.role;

  if (
    typeof candidate.email !== "string" ||
    (role !== "admin" && role !== "member")
  ) {
    throw new Error("The session response did not contain a valid user.");
  }

  const id = candidate.id ?? candidate._id;

  return {
    id: typeof id === "string" ? id : "",
    email: candidate.email,
    role,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function StatusBadge({ status }: { status: ServerStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" />
      {status === "connected"
        ? "Connected"
        : status === "disabled"
          ? "Disabled"
          : "Unreachable"}
    </span>
  );
}

function LoginPage({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      // The server's httpOnly session cookie is the source of authentication.
      const session = await apiRequest<unknown>("/api/auth/me");
      onLogin(readSessionUser(session));
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-brand-panel">
        <div className="brand brand-large">
          <span className="brand-mark">U</span>
          <span>urumi<span className="brand-light">/</span>gateway</span>
        </div>
        <div className="login-pitch">
          <p className="eyebrow">ONE GATEWAY. EVERY TOOL.</p>
          <h1>Your MCP infrastructure, in one place.</h1>
          <p className="muted">
            Manage connected servers and discover the tools available to your
            team through a single, controlled gateway.
          </p>
        </div>
        <p className="panel-footnote">Private by design. Observable by default.</p>
      </section>

      <section className="login-form-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-brand brand">
            <span className="brand-mark">U</span>
            <span>urumi<span className="brand-light">/</span>gateway</span>
          </div>
          <p className="eyebrow">WORKSPACE ACCESS</p>
          <h2>Welcome back</h2>
          <p className="muted">Sign in with your workspace account.</p>

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
          </label>

          <button className="button button-primary button-wide" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
            {!busy && <span aria-hidden="true">→</span>}
          </button>
          <p className="form-footnote">
            Access is managed by your gateway administrator.
          </p>
        </form>
      </section>
    </main>
  );
}

interface ServerDialogProps {
  existing: GatewayServer | null;
  onClose: () => void;
  onSaved: () => void;
}

function ServerDialog({ existing, onClose, onSaved }: ServerDialogProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<"unchanged" | AuthType>(
    existing ? "unchanged" : "none",
  );
  const [headerName, setHeaderName] = useState("");
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const body: Record<string, string | boolean> = { name: name.trim() };

      if (!existing) {
        body.slug = slug.trim();
        body.url = url.trim();
        body.authType = authType;
        body.enabled = true;
      } else {
        // The list endpoint intentionally does not return connection secrets.
        // Blank optional fields preserve the existing server configuration.
        if (url.trim()) body.url = url.trim();
        if (authType !== "unchanged") {
          body.authType = authType;
          if (authType === "header") {
            if (!headerName.trim()) {
              throw new Error("Enter the custom header name.");
            }
            body.headerName = headerName.trim();
          }
        }
      }

      if (authType === "bearer" || authType === "header") {
        if (!credential) {
          throw new Error("Enter the upstream credential for this configuration.");
        }
        body.credential = credential;
      } else if (existing && authType === "unchanged" && credential) {
        // Allow credential rotation without displaying the current value.
        body.credential = credential;
      }

      if (!existing && authType === "header" && !headerName.trim()) {
        throw new Error("Enter the custom header name.");
      }

      await apiRequest(
        existing ? `/api/servers/${encodeURIComponent(existing.id)}` : "/api/servers",
        {
          method: existing ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );

      onSaved();
      onClose();
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-dialog-title"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{existing ? "SERVER SETTINGS" : "NEW CONNECTION"}</p>
            <h2 id="server-dialog-title">{existing ? "Edit server" : "Add MCP server"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        <p className="muted small">
          Upstream credentials are write-only. The existing credential is never
          displayed; leave the credential field blank to keep it when supported.
        </p>

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <form onSubmit={submit} className="dialog-form">
          <label className="field">
            <span>Display name</span>
            <input value={name} onChange={(event) => setName(event.target.value)}
              placeholder="Production WooCommerce" required maxLength={100} />
          </label>

          {!existing && (
            <label className="field">
              <span>Server slug</span>
              <input value={slug} onChange={(event) => setSlug(event.target.value)}
                placeholder="store-api" pattern="[a-z0-9][a-z0-9-]{1,23}"
                title="Use 2–24 lowercase letters, numbers, or hyphens; start with a letter or number."
                required />
              <small>Used to identify and prefix this server's tools. It cannot be changed later.</small>
            </label>
          )}

          <label className="field">
            <span>{existing ? "New URL (optional)" : "MCP endpoint URL"}</span>
            <input value={url} onChange={(event) => setUrl(event.target.value)}
              placeholder={existing ? "Leave blank to keep the current URL" : "http://service:3000/mcp"}
              type="url" required={!existing} maxLength={2048} />
          </label>

          <label className="field">
            <span>Authentication</span>
            <select value={authType} onChange={(event) => {
              setAuthType(event.target.value as "unchanged" | AuthType);
              setCredential("");
            }}>
              {existing && <option value="unchanged">Keep current authentication</option>}
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="header">Custom header</option>
            </select>
          </label>

          {authType === "header" && (
            <label className="field">
              <span>Header name</span>
              <input value={headerName} onChange={(event) => setHeaderName(event.target.value)}
                placeholder="X-API-Key" required />
            </label>
          )}

          {(authType === "bearer" || authType === "header" ||
            (existing && authType === "unchanged")) && (
            <label className="field">
              <span>Upstream credential</span>
              <input value={credential} onChange={(event) => setCredential(event.target.value)}
                type="password" autoComplete="new-password"
                placeholder={existing && authType === "unchanged"
                  ? "Leave blank to preserve the credential"
                  : "Enter credential"} maxLength={4096}
                required={authType === "bearer" || authType === "header"} />
              {existing && <small>For credential rotation only. Nothing is prefilled.</small>}
            </label>
          )}

          <div className="dialog-actions">
            <button type="button" className="button button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="button button-primary" disabled={busy}>
              {busy ? "Saving…" : existing ? "Save changes" : "Add server"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ServersPage({
  servers,
  busy,
  error,
  isAdmin,
  onRefresh,
  onAdd,
  onEdit,
  onChangeEnabled,
  onRemove,
}: {
  servers: GatewayServer[];
  busy: boolean;
  error: string;
  isAdmin: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onEdit: (server: GatewayServer) => void;
  onChangeEnabled: (server: GatewayServer) => void;
  onRemove: (server: GatewayServer) => void;
}) {
  const connected = servers.filter((server) => server.status === "connected").length;
  const unreachable = servers.filter((server) => server.status === "unreachable").length;
  const toolCount = servers.reduce((total, server) => total + server.toolCount, 0);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">GATEWAY MANAGEMENT</p>
          <h1>Server registry</h1>
          <p className="muted">Manage upstream MCP connections and inspect their exposed tools.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-secondary" onClick={onRefresh} disabled={busy}>
            <span aria-hidden="true">↻</span> Refresh
          </button>
          {isAdmin && (
            <button className="button button-primary" onClick={onAdd}>
              <span aria-hidden="true">＋</span> Add server
            </button>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Registered servers</span>
          <strong>{servers.length}</strong>
          <span className="stat-note">Across this gateway</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Connected</span>
          <strong className="stat-good">{connected}</strong>
          <span className="stat-note">Available for tool discovery</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Unreachable</span>
          <strong className={unreachable ? "stat-warn" : ""}>{unreachable}</strong>
          <span className="stat-note">Needs a health check</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Discovered tools</span>
          <strong>{toolCount}</strong>
          <span className="stat-note">From available servers</span>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="section-block">
        <div className="section-title">
          <div>
            <h2>Registered connections</h2>
            <p className="muted small">Tool metadata is cached for up to 60 seconds after successful discovery.</p>
          </div>
          <span className="count-pill">{servers.length} servers</span>
        </div>

        {busy && servers.length === 0 ? (
          <div className="empty-state"><span className="loader" />Loading server registry…</div>
        ) : servers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⌘</div>
            <h3>No MCP servers registered</h3>
            <p className="muted">
              {isAdmin ? "Add an upstream endpoint to begin discovering tools." :
                "Ask an administrator to register an upstream server."}
            </p>
            {isAdmin && <button className="button button-primary" onClick={onAdd}>Add first server</button>}
          </div>
        ) : (
          <div className="server-list">
            {servers.map((server) => (
              <article className="server-card" key={server.id}>
                <div className="server-card-top">
                  <div className="server-identity">
                    <div className={`server-icon server-icon-${server.status}`}>
                      {server.slug.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="server-title">
                      <h3>{server.name}</h3>
                      <div className="server-subtitle">
                        <code>{server.slug}</code>
                        <span className="dot-separator">·</span>
                        <span>{server.toolCount} {server.toolCount === 1 ? "tool" : "tools"}</span>
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={server.status} />
                </div>

                {server.statusReason && server.status !== "connected" && (
                  <p className="status-reason">{server.statusReason}</p>
                )}

                <div className="server-tools">
                  <div className="tools-heading">
                    <span>EXPOSED TOOLS</span>
                    {server.hasCredential && <span className="credential-indicator">● Credential configured</span>}
                  </div>
                  {server.tools.length ? (
                    <div className="tool-list">
                      {server.tools.map((tool) => (
                        <div className="tool-row" key={tool.name}>
                          <span className="tool-symbol">↳</span>
                          <div>
                            <code>{tool.name}</code>
                            {tool.description && <p>{tool.description}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="no-tools">
                      {server.enabled
                        ? "No cached tools. They appear after successful discovery."
                        : "This server is disabled; its tools are not exposed."}
                    </p>
                  )}
                </div>

                {isAdmin && (
                  <div className="server-actions">
                    <button className="button button-secondary button-small"
                      onClick={() => onEdit(server)}>Edit</button>
                    <button className="button button-secondary button-small"
                      onClick={() => onChangeEnabled(server)}>
                      {server.enabled ? "Disable" : "Enable"}
                    </button>
                    <button className="button button-danger button-small"
                      onClick={() => onRemove(server)}>Remove</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function App() {
  const [activePage, setActivePage] = useState<DashboardPage>("servers");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [servers, setServers] = useState<GatewayServer[]>([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [serversError, setServersError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);
  const [dialogServer, setDialogServer] = useState<GatewayServer | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;

    apiRequest<unknown>("/api/auth/me")
      .then((payload) => {
        if (active) setUser(readSessionUser(payload));
      })
      .catch((error: unknown) => {
        if (active && (!(error instanceof ApiError) || error.status !== 401)) {
          setSessionError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (active) setSessionLoading(false);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return;

    let active = true;

    apiRequest<{ servers: GatewayServer[] }>("/api/servers")
      .then((payload) => {
        if (active) {
          setServers(payload.servers);
          setServersError("");
        }
      })
      .catch((error: unknown) => {
        if (active) setServersError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setServersLoading(false);
      });

    return () => { active = false; };
  }, [user, reloadCount]);

  async function refreshServers() {
    setServersLoading(true);
    setServersError("");
    setReloadCount((count) => count + 1);
  }

  async function logout() {
    setSigningOut(true);
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch {
      // Clear local state even if the session has already expired.
    } finally {
      setUser(null);
      setServers([]);
      setServersLoading(false);
      setServersError("");
      setSigningOut(false);
      setSessionError("");
    }
  }

  async function changeEnabled(server: GatewayServer) {
    setActionError("");
    try {
      await apiRequest(`/api/servers/${encodeURIComponent(server.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      await refreshServers();
    } catch (error: unknown) {
      setActionError(getErrorMessage(error));
    }
  }

  async function removeServer(server: GatewayServer) {
    if (!window.confirm(`Remove "${server.name}" from the gateway?`)) return;

    setActionError("");
    try {
      await apiRequest(`/api/servers/${encodeURIComponent(server.id)}`, {
        method: "DELETE",
      });
      await refreshServers();
    } catch (error: unknown) {
      setActionError(getErrorMessage(error));
    }
  }

  if (sessionLoading) {
    return <main className="app-loading"><span className="loader" />Checking your session…</main>;
  }

  const invitationMatch = /^\/invite\/([^/]+)\/?$/.exec(window.location.pathname);
  if (invitationMatch?.[1]) {
    return <AcceptInvitePage token={decodeURIComponent(invitationMatch[1])} />;
  }

  if (!user) {
    return (
      <>
        {sessionError && (
          <div className="startup-error" role="alert">
            Could not check the gateway session: {sessionError}
          </div>
        )}
        <LoginPage onLogin={(nextUser) => {
          setSessionError("");
          setServersLoading(true);
          setServersError("");
          setUser(nextUser);
        }} />
      </>
    );
  }

  const isAdmin = user.role === "admin";

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">U</span>
          <span>urumi<span className="brand-light">/</span>gateway</span>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          <button type="button" className={`nav-item ${activePage === "servers" ? "nav-item-active" : ""}`}
            onClick={() => setActivePage("servers")}>
            <span className="nav-icon">▦</span><span>Server registry</span>
          </button>
          {isAdmin && (
            <button type="button" className={`nav-item ${activePage === "members" ? "nav-item-active" : ""}`}
              onClick={() => setActivePage("members")}>
              <span className="nav-icon">♙</span><span>Team members</span>
            </button>
          )}
          <button type="button" className={`nav-item ${activePage === "keys" ? "nav-item-active" : ""}`}
            onClick={() => setActivePage("keys")}>
            <span className="nav-icon">⌘</span><span>API keys</span>
          </button>
          <button type="button" className={`nav-item ${activePage === "chat" ? "nav-item-active" : ""}`}
            onClick={() => setActivePage("chat")}>
            <span className="nav-icon">✧</span><span>Chat</span>
          </button>
          <button type="button" className={`nav-item ${activePage === "audit" ? "nav-item-active" : ""}`}
            onClick={() => setActivePage("audit")}>
            <span className="nav-icon">▤</span><span>Audit log</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-summary">
            <span className="connection-light" />
            <div>
              <strong>Gateway session</strong>
              <small>Authenticated</small>
            </div>
          </div>
          <div className="user-summary">
            <div className="avatar">{user.email.slice(0, 1).toUpperCase()}</div>
            <div className="user-summary-copy">
              <strong>{user.email}</strong>
              <small>{isAdmin ? "Administrator" : "Team member"}</small>
            </div>
            <button className="icon-button signout-button" onClick={logout}
              disabled={signingOut} aria-label="Sign out" title="Sign out">
              ⇥
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span><span>/</span>
            <strong>{
              activePage === "servers" ? "Servers" :
              activePage === "members" ? "Team members" :
              activePage === "keys" ? "API keys" :
              activePage === "chat" ? "Chat" : "Audit log"
            }</strong>
          </div>
          <div className="topbar-right">
            <span className="secure-label"><span>●</span> Session protected</span>
            <span className="role-chip">{user.role}</span>
          </div>
        </header>

        <div className="page-content">
          {actionError && (
            <div className="alert alert-error action-alert" role="alert">
              {actionError}
              <button className="alert-dismiss" onClick={() => setActionError("")} aria-label="Dismiss">×</button>
            </div>
          )}

          {activePage === "servers" && (
            <ServersPage
              servers={servers}
              busy={serversLoading}
              error={serversError}
              isAdmin={isAdmin}
              onRefresh={() => void refreshServers()}
              onAdd={() => { setDialogServer(null); setDialogOpen(true); }}
              onEdit={(server) => { setDialogServer(server); setDialogOpen(true); }}
              onChangeEnabled={(server) => void changeEnabled(server)}
              onRemove={(server) => void removeServer(server)}
            />
          )}
          {activePage === "members" && isAdmin && <MembersPage />}
          {activePage === "keys" && <KeysPage currentUser={user} />}
          {activePage === "chat" && <ChatPage />}
          {activePage === "audit" && <AuditPage currentUser={user} />}
        </div>
      </main>

      {dialogOpen && (
        <ServerDialog
          existing={dialogServer}
          onClose={() => setDialogOpen(false)}
          onSaved={() => { void refreshServers(); }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
