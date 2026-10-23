import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

interface ToolCallSummary {
  server: string;
  tool: string;
  ok: boolean;
  durationMs: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallSummary[];
}

interface ChatResult {
  reply: string;
  toolCalls: ToolCallSummary[];
}

class ChatRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ChatRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestHistory(
  history: ChatMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  // Match the gateway's message count and content limits.
  const selected: Array<{ role: "user" | "assistant"; content: string }> = [];
  let totalChars = 0;

  for (
    let index = history.length - 1;
    index >= 0 && selected.length < 20;
    index -= 1
  ) {
    const message = history[index];
    if (!message || message.content.length > 4_000) continue;
    if (totalChars + message.content.length > 20_000) break;

    selected.push({ role: message.role, content: message.content });
    totalChars += message.content.length;
  }

  return selected.reverse();
}

function parseChatResult(value: unknown): ChatResult {
  if (
    !isRecord(value) ||
    typeof value.reply !== "string" ||
    !Array.isArray(value.toolCalls)
  ) {
    throw new Error("The chat service returned an invalid response. Please try again.");
  }

  const toolCalls: ToolCallSummary[] = [];

  for (const item of value.toolCalls) {
    if (
      !isRecord(item) ||
      typeof item.server !== "string" ||
      typeof item.tool !== "string" ||
      typeof item.ok !== "boolean" ||
      typeof item.durationMs !== "number" ||
      !Number.isFinite(item.durationMs) ||
      item.durationMs < 0
    ) {
      throw new Error("The chat service returned an invalid response. Please try again.");
    }

    toolCalls.push({
      server: item.server.slice(0, 64),
      tool: item.tool.slice(0, 128),
      ok: item.ok,
      durationMs: Math.min(item.durationMs, 120_000),
    });
  }

  return { reply: value.reply.slice(0, 12_000), toolCalls };
}

async function sendChatRequest(history: ChatMessage[]): Promise<ChatResult> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({ messages: requestHistory(history) }),
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
    const error =
      isRecord(payload) && isRecord(payload.error) ? payload.error : {};
    const code =
      typeof error.code === "string" ? error.code : "chat_request_failed";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The chat request failed.";

    throw new ChatRequestError(message, response.status, code);
  }

  return parseChatResult(payload);
}

function friendlyError(error: unknown): string {
  if (error instanceof ChatRequestError) {
    if (error.status === 401) {
      return "Your session has expired. Sign in again to continue chatting.";
    }
    if (error.code === "chat_not_configured") {
      return "Chat is not configured yet. Ask your gateway administrator to configure the LLM provider.";
    }
    if (error.status === 400) {
      return "This conversation is too large or the message is invalid. Start a new chat or ask a shorter question.";
    }
    if (error.status === 502 || error.status === 503) {
      return "The chat service is temporarily unavailable. Check the configuration or try again.";
    }
    return error.message;
  }

  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong while sending your message. Please try again.";
}

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorRetryable, setErrorRetryable] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function requestReply(history: ChatMessage[]) {
    setBusy(true);
    setError("");
    setErrorRetryable(false);

    try {
      const result = await sendChatRequest(history);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.reply,
          toolCalls: result.toolCalls,
        },
      ]);
    } catch (requestError: unknown) {
      setError(friendlyError(requestError));
      setErrorRetryable(
        history[history.length - 1]?.role === "user",
      );
    } finally {
      setBusy(false);
    }
  }

  function sendDraft() {
    const content = draft.trim();
    if (!content || busy || content.length > 4_000) return;

    const nextHistory: ChatMessage[] = [
      ...messages,
      { role: "user", content },
    ];

    setMessages(nextHistory);
    setDraft("");
    void requestReply(nextHistory);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendDraft();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  const lastMessage = messages[messages.length - 1];
  const canRetry = errorRetryable && lastMessage?.role === "user" && !busy;

  function startNewChat() {
    if (busy) return;
    setMessages([]);
    setDraft("");
    setError("");
    setErrorRetryable(false);
  }

  return (
    <section className="management-page">
      <div
        className="page-heading"
        style={{ alignItems: "flex-start", gap: 16 }}
      >
        <div>
          <p className="eyebrow">ASSISTED WORKFLOWS</p>
          <h1>Chat with your tools</h1>
          <p className="muted">
            Ask questions across tools exposed by connected MCP servers. Tool
            calls use your signed-in gateway session.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={startNewChat}
          disabled={busy || (messages.length === 0 && !error)}
        >
          New chat
        </button>
      </div>

      <section
        className="management-panel"
        aria-label="Chat workspace"
        style={{ padding: 0, overflow: "hidden" }}
      >
        <div
          role="log"
          aria-label="Conversation"
          aria-live="polite"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minHeight: 260,
            maxHeight: "min(52vh, 560px)",
            overflowY: "auto",
            padding: 20,
          }}
        >
          {messages.length === 0 ? (
            <div
              className="empty-state"
              style={{
                minHeight: 220,
                border: 0,
                background: "transparent",
              }}
            >
              <div aria-hidden="true" style={{ fontSize: 28 }}>✧</div>
              <h3>What would you like to find?</h3>
              <p>
                Ask a question about data available through your connected MCP
                tools. The gateway decides which tools are available to your
                account.
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <article
                key={`${index}-${message.role}`}
                style={{
                  alignSelf:
                    message.role === "user" ? "flex-end" : "stretch",
                  width:
                    message.role === "user" ? "min(90%, 680px)" : "100%",
                  maxWidth: "100%",
                }}
              >
                <div
                  style={{
                    fontSize: ".75rem",
                    fontWeight: 700,
                    color: "var(--muted)",
                    marginBottom: 6,
                  }}
                >
                  {message.role === "user" ? "YOU" : "URUMI ASSISTANT"}
                </div>

                <div
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: "13px 15px",
                    background:
                      message.role === "user" ? "#f0efff" : "#fbfcfe",
                    color: "var(--text, #202c42)",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    lineHeight: 1.6,
                  }}
                >
                  {message.content}
                </div>

                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div style={{ display: "grid", gap: 7, marginTop: 9 }}>
                    <div
                      style={{
                        fontSize: ".75rem",
                        color: "var(--muted)",
                        fontWeight: 700,
                      }}
                    >
                      TOOL CALLS
                    </div>

                    {message.toolCalls.map((call, callIndex) => (
                      <div
                        key={`${call.server}-${call.tool}-${callIndex}`}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                          padding: "9px 11px",
                          border: "1px solid var(--line)",
                          borderRadius: 9,
                          fontSize: ".82rem",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            color: call.ok ? "#178254" : "#a72f3a",
                            fontWeight: 800,
                          }}
                        >
                          {call.ok ? "✓" : "!"}
                        </span>
                        <strong>{call.server}</strong>
                        <span aria-hidden="true">/</span>
                        <strong>{call.tool}</strong>
                        <span
                          style={{
                            color: "var(--muted)",
                            marginLeft: "auto",
                          }}
                        >
                          {call.ok ? "Succeeded" : "Failed"} ·{" "}
                          {Math.round(call.durationMs)} ms
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))
          )}

          {busy && (
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "var(--muted)",
                padding: "4px 0",
              }}
            >
              <span className="loader" aria-hidden="true" />
              Thinking and checking available tools…
            </div>
          )}
        </div>

        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: 18,
            background: "white",
          }}
        >
          {error && (
            <div
              className="alert alert-error"
              role="alert"
              style={{ marginBottom: 12 }}
            >
              <div>{error}</div>
              {canRetry && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => void requestReply(messages)}
                  style={{ marginTop: 9 }}
                >
                  Retry last message
                </button>
              )}
            </div>
          )}

          <form ref={formRef} onSubmit={submit}>
            <label className="field" style={{ margin: 0 }}>
              <span>Message</span>
              <textarea
                aria-label="Message"
                rows={3}
                maxLength={4_000}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Ask a question about your connected tools…"
                disabled={busy}
                style={{
                  width: "100%",
                  resize: "vertical",
                  minHeight: 78,
                  boxSizing: "border-box",
                }}
              />
            </label>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginTop: 10,
                flexWrap: "wrap",
              }}
            >
              <span className="muted small">
                Enter to send · Shift+Enter for a new line · Conversation stays
                in this page&apos;s memory.
              </span>
              <button
                type="submit"
                className="button button-primary"
                disabled={busy || !draft.trim()}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </section>
  );
}
