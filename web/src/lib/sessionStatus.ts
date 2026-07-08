import type { NormalizedEvent, SessionSnapshot } from "../types.js";

export type Status =
  | { kind: "no_session" }
  | { kind: "working";  ageMs: number; currentTool?: string }
  | { kind: "thinking"; ageMs: number }
  | { kind: "stuck";    ageMs: number; loopLabel: string }
  | { kind: "errored";  ageMs: number; toolName?: string }
  | { kind: "idle";     ageMs: number }
  | { kind: "done";     ageMs: number };

export const IDLE_THRESHOLD_MS = 30_000;   // P2: p95 active inter-tool gap is 24s
export const LOOP_WINDOW_MS    = 60_000;   // P2: 3 retries fit in this window
export const LOOP_MIN_FAILURES = 3;

/** Returns the session's current status word + age + optional details.
 *  Priority: STUCK > ERRORED > WORKING > DONE > THINKING > IDLE. */
export function sessionStatus(snapshot: SessionSnapshot | undefined, now: number): Status {
  if (!snapshot) return { kind: "no_session" };

  const events = snapshot.recentEvents;
  const lastAt = snapshot.lastEventAt || (events.length ? events[events.length - 1].ts : 0);
  const ageMs = Math.max(0, now - lastAt);

  // Find pending tools (Pre without matching Post)
  const pending = new Map<string, NormalizedEvent>();
  for (const e of events) {
    if (e.kind === "PreToolUse" && e.toolUseId) pending.set(e.toolUseId, e);
    else if (e.kind === "PostToolUse" && e.toolUseId) pending.delete(e.toolUseId);
  }

  // Loop detection: same (tool, normalized input) with is_error, LOOP_MIN_FAILURES times in window
  const stuck = detectStuck(events, now);
  if (stuck) return { kind: "stuck", ageMs, loopLabel: stuck };

  // Most recent PostToolUse determines errored-without-recovery
  let lastPost: NormalizedEvent | undefined;
  let lastStop: NormalizedEvent | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!lastPost && e.kind === "PostToolUse") lastPost = e;
    if (!lastStop && e.kind === "Stop") lastStop = e;
    if (lastPost && lastStop) break;
  }

  if (lastPost?.toolResponse?.isError) {
    // Errored unless a newer success (Post without isError) came after — we checked lastPost is the last.
    if (pending.size === 0) return { kind: "errored", ageMs, toolName: lastPost.toolName };
  }

  // Actively running a tool
  if (pending.size > 0) {
    const newest = [...pending.values()].sort((a, b) => b.ts - a.ts)[0];
    return { kind: "working", ageMs: now - newest.ts, currentTool: newest.toolName };
  }

  // DONE: Stop is the strictly-last relevant event
  const lastIdx = events.length - 1;
  if (lastIdx >= 0 && events[lastIdx].kind === "Stop") return { kind: "done", ageMs };

  // THINKING vs IDLE
  if (ageMs >= IDLE_THRESHOLD_MS) return { kind: "idle", ageMs };
  return { kind: "thinking", ageMs };
}

function detectStuck(events: NormalizedEvent[], now: number): string | null {
  const counts = new Map<string, { count: number; lastTs: number; toolName: string; detail: string }>();
  for (const e of events) {
    if (e.kind !== "PostToolUse") continue;
    if (!e.toolResponse?.isError) continue;
    if (now - e.ts > LOOP_WINDOW_MS) continue;
    const key = hashToolInput(e.toolName ?? "?", e.toolInput);
    const detail = describeDetail(e.toolName, e.toolInput);
    const entry = counts.get(key) ?? { count: 0, lastTs: 0, toolName: e.toolName ?? "?", detail };
    entry.count++;
    entry.lastTs = Math.max(entry.lastTs, e.ts);
    counts.set(key, entry);
  }
  let best: { count: number; toolName: string; detail: string } | null = null;
  for (const v of counts.values()) {
    if (v.count >= LOOP_MIN_FAILURES && (!best || v.count > best.count)) {
      best = { count: v.count, toolName: v.toolName, detail: v.detail };
    }
  }
  if (!best) return null;
  return `${best.toolName}${best.detail ? ` ${best.detail}` : ""} ×${best.count}`;
}

function hashToolInput(toolName: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  // Normalize: for file tools use path; for Bash use command; for Grep use pattern.
  const key =
    typeof i.file_path === "string" ? i.file_path :
    typeof i.command   === "string" ? i.command :
    typeof i.pattern   === "string" ? i.pattern :
    JSON.stringify(i);
  return `${toolName}::${key}`;
}

function describeDetail(toolName: string | undefined, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i.file_path === "string") return i.file_path;
  if (typeof i.command === "string")   return i.command.slice(0, 40);
  if (typeof i.pattern === "string")   return `"${i.pattern}"`;
  return "";
}
