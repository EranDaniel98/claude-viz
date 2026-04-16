import type { SessionSnapshot, NormalizedEvent } from "../types.js";

interface Props { snapshot?: SessionSnapshot }

const toolIcon = (name?: string): string => {
  switch (name) {
    case "Edit": return "✏️";
    case "Write": return "📝";
    case "Read": return "📖";
    case "Grep": return "🔍";
    case "Bash": return "⚡";
    case "Glob": return "📁";
    case "Task":
    case "Agent": return "🤖";
    case "WebFetch":
    case "WebSearch": return "🌐";
    default: return "•";
  }
};

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
};

/** Short label — always the tool name when we have one, never "PreToolUse". */
function toolLabel(event: NormalizedEvent): string {
  return event.toolName ?? event.kind;
}

/** The most salient content bit for this event — what is it actually *about*? */
function detailFor(event: NormalizedEvent): string {
  const input = event.toolInput as Record<string, unknown> | undefined;
  if (input) {
    const s = (k: string): string | undefined =>
      typeof input[k] === "string" ? (input[k] as string) : undefined;
    switch (event.toolName) {
      case "Read":
      case "Write":
      case "Edit":
      case "NotebookEdit":
        return s("file_path") ?? "";
      case "Grep":
        return s("pattern") ? `"${s("pattern")}"` : "";
      case "Glob":
        return s("pattern") ?? "";
      case "Bash":
        return s("command") ?? "";
      case "Task":
      case "Agent": {
        const kind = s("subagent_type") ?? s("agent_type");
        const brief = (s("description") ?? s("prompt") ?? "").split("\n")[0];
        return kind ? `[${kind}] ${brief}` : brief;
      }
      case "WebFetch":
        return s("url") ?? "";
      case "WebSearch":
        return s("query") ?? "";
      default:
        try { return JSON.stringify(input).slice(0, 140); } catch { return ""; }
    }
  }
  switch (event.kind) {
    case "SubagentStart":
      return `${event.agentType ?? "agent"} started`;
    case "SubagentStop": {
      const first = (event.lastAssistantMessage ?? "").split("\n")[0];
      return `${event.agentType ?? "agent"}${first ? ` · ${first}` : ""}`;
    }
    case "UserPromptSubmit":
      return (event.prompt ?? "").split("\n")[0];
    case "SessionStart":
      return "session started";
    default:
      return "";
  }
}

const MAX_DETAIL = 140;
function truncate(s: string): string {
  return s.length > MAX_DETAIL ? s.slice(0, MAX_DETAIL) + "…" : s;
}

export function LiveActivity({ snapshot }: Props) {
  if (!snapshot) {
    return <div className="empty" aria-label="waiting for events">
      <div className="panel-title">Live Activity</div>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Waiting for events…<br />
        Open a new terminal and run <code>claude</code>.
      </p>
    </div>;
  }

  const events = snapshot.recentEvents.slice(-60).reverse();
  return (
    <div>
      <div className="panel-title">Live Activity <span style={{ color: "var(--ok)" }}>● LIVE</span></div>
      <ul className="feed" role="log" aria-live="polite">
        {events.map((e) => <FeedRow key={e.seq} event={e} />)}
      </ul>
    </div>
  );
}

function FeedRow({ event }: { event: NormalizedEvent }) {
  const isErr = event.toolResponse?.isError;
  const phase = event.kind === "PreToolUse" ? "start"
    : event.kind === "PostToolUse" ? "done"
    : undefined;
  const cls = `row${isErr ? " err" : ""}${phase === "start" ? " start" : ""}`;
  const detail = truncate(detailFor(event));
  const title = `${event.kind} · ${event.toolName ?? ""} · ${detail}`.trim();

  return (
    <li className={cls} title={title}>
      <span className="ts">{fmtTime(event.ts)}</span>
      <span className="tool" aria-label={toolLabel(event)}>
        {toolIcon(event.toolName)} {toolLabel(event)}
      </span>
      {detail && <span className="detail">{detail}</span>}
      {phase === "start" && <span className="tag muted">→</span>}
      {isErr && <span className="tag err">error</span>}
      {event.redactions > 0 && <span className="tag muted">[redacted:{event.redactions}]</span>}
    </li>
  );
}
