import { useState } from "react";
import type { SessionSnapshot, NormalizedEvent } from "../types.js";
import { mergeFeedEvents, type FeedRow, type ToolRow, type PromptRow, type TurnEndRow, type ExplorationRow } from "../lib/mergeFeed.js";

type Filter = "edits" | "bash" | "reads" | "subagents" | "errors";
const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const SUBAGENT_KINDS = new Set(["SubagentStart", "SubagentStop"]);

function matches(row: FeedRow, active: Set<Filter>): boolean {
  if (active.size === 0) return true;
  if (row.kind === "prompt" || row.kind === "turn_end") return true; // structural, always shown
  if (row.kind === "exploration") return active.has("reads");
  if (row.kind === "tool") {
    if (active.has("errors") && row.isError) return true;
    if (active.has("edits") && EDIT_TOOLS.has(row.toolName)) return true;
    if (active.has("bash")  && row.toolName === "Bash") return true;
    if (active.has("reads") && READ_TOOLS.has(row.toolName)) return true;
    if (active.has("subagents") && (row.toolName === "Task" || row.toolName === "Agent")) return true;
    return false;
  }
  if (active.has("subagents") && SUBAGENT_KINDS.has(row.event.kind)) return true;
  return false;
}

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

const fmtDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
};

function detailForTool(toolName: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (k: string): string | undefined =>
    typeof i[k] === "string" ? (i[k] as string) : undefined;
  switch (toolName) {
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
      try { return JSON.stringify(i).slice(0, 140); } catch { return ""; }
  }
}

function detailForEvent(event: NormalizedEvent): string {
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

  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const toggle = (f: Filter) => setFilters((s) => {
    const next = new Set(s);
    next.has(f) ? next.delete(f) : next.add(f);
    return next;
  });

  const merged = mergeFeedEvents(snapshot.recentEvents).filter((r) => matches(r, filters)).slice(-60);
  const rows = withDeltas(merged).reverse();
  return (
    <div>
      <div className="panel-title">Live Activity <span style={{ color: "var(--ok)" }}>● LIVE</span></div>
      <div className="filters" role="toolbar" aria-label="feed filters">
        {(["edits", "bash", "reads", "subagents", "errors"] as Filter[]).map((f) => (
          <button
            key={f}
            className={`chip ${filters.has(f) ? "on" : ""}`}
            aria-pressed={filters.has(f)}
            onClick={() => toggle(f)}
          >{f}</button>
        ))}
      </div>
      <ul className="feed" role="log" aria-live="polite">
        {rows.map(({ row, deltaMs }) => (
          <FeedRowEl key={rowKey(row)} row={row} deltaMs={deltaMs} />
        ))}
      </ul>
    </div>
  );
}

function tsOf(row: FeedRow): number {
  switch (row.kind) {
    case "tool":        return row.startedAt;
    case "prompt":      return row.ts;
    case "turn_end":    return row.ts;
    case "exploration": return row.ts;
    case "event":       return row.event.ts;
  }
}

function withDeltas(rows: FeedRow[]): { row: FeedRow; deltaMs?: number }[] {
  return rows.map((row, i) => {
    if (i === 0) return { row };
    return { row, deltaMs: tsOf(row) - tsOf(rows[i - 1]) };
  });
}

function fmtDelta(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `+${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `+${m}m${Math.floor(s % 60)}s`;
}

function rowKey(row: FeedRow): string {
  switch (row.kind) {
    case "tool":        return `t:${row.toolUseId}`;
    case "prompt":      return `p:${row.seq}`;
    case "turn_end":    return `te:${row.seq}`;
    case "exploration": return `ex:${row.seq}`;
    case "event":       return `e:${row.event.seq}`;
  }
}

function FeedRowEl({ row, deltaMs }: { row: FeedRow; deltaMs?: number }) {
  switch (row.kind) {
    case "tool":        return <ToolRowEl row={row} deltaMs={deltaMs} />;
    case "prompt":      return <PromptRowEl row={row} deltaMs={deltaMs} />;
    case "turn_end":    return <TurnEndRowEl row={row} />;
    case "exploration": return <ExplorationRowEl row={row} deltaMs={deltaMs} />;
    case "event":       return <EventRowEl event={row.event} deltaMs={deltaMs} />;
  }
}

function ExplorationRowEl({ row, deltaMs }: { row: ExplorationRow; deltaMs?: number }) {
  const [open, setOpen] = useState(false);
  const summary = row.paths.slice(0, 4).map(basename).join(", ");
  const more = row.paths.length > 4 ? `, +${row.paths.length - 4}` : "";
  return (
    <>
      <li className="row exploration" title={row.paths.join("\n")}>
        <DeltaGutter deltaMs={deltaMs} />
        <span className="ts">{fmtTime(row.ts)}</span>
        <span className="tool">🔎 explored {row.count} files</span>
        <span className="detail">{summary}{more}</span>
        <button className="exp-toggle" aria-expanded={open}
                onClick={() => setOpen((v) => !v)}>{open ? "▾" : "▸"}</button>
      </li>
      {open && row.paths.map((p, i) => (
        <li key={i} className="row exp-child">
          <span className="delta" />
          <span className="ts" />
          <span className="detail">{p}</span>
        </li>
      ))}
    </>
  );
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function TurnEndRowEl({ row }: { row: TurnEndRow }) {
  const stats: string[] = [];
  if (row.durationMs !== undefined) stats.push(fmtDuration(row.durationMs));
  stats.push(`${row.toolCount} tool${row.toolCount === 1 ? "" : "s"}`);
  if (row.editCount > 0) stats.push(`${row.editCount} edit${row.editCount === 1 ? "" : "s"}`);
  return (
    <li className="row turn-end" aria-label="turn ended">
      <span className="turn-end-label">──── turn end · {stats.join(" · ")} ────</span>
    </li>
  );
}

function DeltaGutter({ deltaMs }: { deltaMs?: number }) {
  return <span className="delta" aria-hidden="true">{deltaMs !== undefined ? fmtDelta(deltaMs) : ""}</span>;
}

function PromptRowEl({ row, deltaMs }: { row: PromptRow; deltaMs?: number }) {
  return (
    <li className="row prompt-divider" title={row.text}>
      <DeltaGutter deltaMs={deltaMs} />
      <span className="ts">{fmtTime(row.ts)}</span>
      <span className="prompt-text">› {row.text || "(empty prompt)"}</span>
    </li>
  );
}

function ToolRowEl({ row, deltaMs }: { row: ToolRow; deltaMs?: number }) {
  const detail = truncate(detailForTool(row.toolName, row.toolInput));
  const cls = `row${row.isError ? " err banner" : ""}${row.isPending ? " pending" : ""}`;
  const title = `${row.toolName}${detail ? ` · ${detail}` : ""}`;
  return (
    <li className={cls} title={title}>
      <DeltaGutter deltaMs={deltaMs} />
      <span className="ts">{fmtTime(row.startedAt)}</span>
      <span className="tool" aria-label={row.toolName}>
        {toolIcon(row.toolName)} {row.toolName}
      </span>
      {detail && <span className="detail">{detail}</span>}
      {row.isPending
        ? <span className="tag muted" aria-label="in flight">…</span>
        : <span className="tag muted">{fmtDuration(row.durationMs ?? 0)}</span>}
      {row.isError && <span className="tag err">error</span>}
      {row.redactions > 0 && <span className="tag muted">[redacted:{row.redactions}]</span>}
    </li>
  );
}

function EventRowEl({ event, deltaMs }: { event: NormalizedEvent; deltaMs?: number }) {
  const detail = truncate(detailForEvent(event));
  const title = `${event.kind}${detail ? ` · ${detail}` : ""}`;
  return (
    <li className="row" title={title}>
      <DeltaGutter deltaMs={deltaMs} />
      <span className="ts">{fmtTime(event.ts)}</span>
      <span className="tool">{event.kind}</span>
      {detail && <span className="detail">{detail}</span>}
      {event.redactions > 0 && <span className="tag muted">[redacted:{event.redactions}]</span>}
    </li>
  );
}
