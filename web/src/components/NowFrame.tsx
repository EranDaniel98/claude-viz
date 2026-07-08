import { useEffect, useState } from "react";
import type { SessionSnapshot, NormalizedEvent } from "../types.js";
import { sessionStatus, IDLE_THRESHOLD_MS } from "../lib/sessionStatus.js";

interface Props { snapshot?: SessionSnapshot }

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function fmtAge(ms: number): string {
  if (ms < 1000) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

function detailForTool(toolName: string | undefined, input: unknown): string {
  if (!toolName) return "";
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (k: string): string | undefined =>
    typeof i[k] === "string" ? (i[k] as string) : undefined;
  switch (toolName) {
    case "Read": case "Write": case "Edit": case "NotebookEdit": return s("file_path") ?? "";
    case "Grep":  return s("pattern") ? `"${s("pattern")}"` : "";
    case "Glob":  return s("pattern") ?? "";
    case "Bash":  return s("command") ?? "";
    case "WebFetch": return s("url") ?? "";
    case "WebSearch": return s("query") ?? "";
    default: return "";
  }
}

function findNewestPendingPre(events: NormalizedEvent[]): NormalizedEvent | undefined {
  const pending = new Map<string, NormalizedEvent>();
  for (const e of events) {
    if (e.kind === "PreToolUse" && e.toolUseId) pending.set(e.toolUseId, e);
    else if (e.kind === "PostToolUse" && e.toolUseId) pending.delete(e.toolUseId);
  }
  let best: NormalizedEvent | undefined;
  for (const e of pending.values()) if (!best || e.ts > best.ts) best = e;
  return best;
}

function findLastPost(events: NormalizedEvent[]): NormalizedEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === "PostToolUse") return events[i];
  return undefined;
}

export function NowFrame({ snapshot }: Props) {
  const now = useNow(1000);
  if (!snapshot) return null;
  const status = sessionStatus(snapshot, now);

  let glyph = "●", message = "", className = "now-frame";

  switch (status.kind) {
    case "no_session":
      return null;

    case "working": {
      const pre = findNewestPendingPre(snapshot.recentEvents);
      const detail = pre ? detailForTool(pre.toolName, pre.toolInput) : "";
      message = detail
        ? `${status.currentTool ?? "tool"}: ${detail} — ${fmtAge(status.ageMs)}`
        : `${status.currentTool ?? "tool"} — ${fmtAge(status.ageMs)}`;
      break;
    }
    case "thinking":
      message = `Thinking — ${fmtAge(status.ageMs)}`;
      glyph = "✴";
      break;
    case "stuck":
      glyph = "⚠";
      className += " warn";
      message = `Loop detected — ${status.loopLabel}`;
      break;
    case "errored": {
      glyph = "⛔";
      className += " err";
      const post = findLastPost(snapshot.recentEvents);
      const detail = post ? detailForTool(post.toolName, post.toolInput) : "";
      message = detail
        ? `${post?.toolName ?? "Tool"} failed: ${detail}`
        : `${post?.toolName ?? "Tool"} failed`;
      break;
    }
    case "idle": {
      glyph = "⚠";
      className += " muted";
      const post = findLastPost(snapshot.recentEvents);
      const last = post ? `${post.toolName ?? "tool"}${post.toolResponse?.isError ? " (error)" : " (ok)"}` : "no activity";
      message = `Quiet ${fmtAge(status.ageMs - IDLE_THRESHOLD_MS + IDLE_THRESHOLD_MS)} — last: ${last}`;
      break;
    }
    case "done":
      glyph = "✓";
      className += " ok";
      message = `Turn ended · ${fmtAge(status.ageMs)} ago`;
      break;
  }

  return (
    <div className={className} role="status">
      <span className="now-glyph" aria-hidden="true">{glyph}</span>
      <span className="now-message">{message}</span>
    </div>
  );
}
