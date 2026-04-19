import { redactValue } from "./redact.js";
import { parseBashMutations } from "./bashScope.js";
import type {
  NormalizedEvent, RawHookEvent, SessionScope, SessionSnapshot, SubagentNode,
} from "./types.js";

const RECENT_LIMIT = 200;
/** Sessions inactive for this long are dropped on the next GC sweep. */
const DEFAULT_SESSION_TTL_MS = 6 * 60 * 60 * 1000;  // 6h
/** Max in-flight tool calls per session before FIFO eviction kicks in.
 *  Protects against unbounded growth from Pre events with no Post. */
const PENDING_TOOL_LIMIT = 256;

interface SessionRecord {
  sessionId: string;
  cwd: string;
  model?: string;
  startedAt: number;
  lastEventAt: number;
  toolCalls: number;
  redactions: number;
  scope: SessionScope;
  subagents: Map<string, SubagentNode>;
  recentEvents: NormalizedEvent[];
  pendingToolCalls: Map<string, string>; // toolUseId → toolName
  // FIFO queue of recent Task/Agent prompts. SubagentStart pops the
  // oldest one and attaches it to the new SubagentNode.brief.
  pendingTaskPrompts: string[];
  transcriptPath?: string;
  context?: SessionSnapshot["context"];
}

export interface SessionStateStoreOptions {
  /** Inactive-session TTL in ms. 0 disables GC. */
  sessionTtlMs?: number;
}

export class SessionStateStore {
  private sessions = new Map<string, SessionRecord>();
  // child session_id -> (parent session_id, agent_id) — lets us attribute
  // tool events that fire against a subagent's own session back to the
  // SubagentNode on its parent.
  private childToAgent = new Map<string, { parentSid: string; agentId: string }>();
  private readonly sessionTtlMs: number;

  constructor(opts: SessionStateStoreOptions = {}) {
    this.sessionTtlMs = opts.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  }

  // Redacts a hook event, buffers it on its session, and updates tool/scope/subagent state.
  ingest(raw: RawHookEvent, seq: number, ts: number): void {
    if (!raw.session_id) return;

    // Redact entire raw event once; we'll pull redacted fields as needed.
    const { value: rv, count: redactions } = redactValue(raw) as {
      value: RawHookEvent; count: number;
    };

    const sid = rv.session_id;
    const rec = this.ensureSession(sid, rv.cwd, ts);
    rec.lastEventAt = ts;
    rec.redactions += redactions;
    if (rv.transcript_path && !rec.transcriptPath) rec.transcriptPath = rv.transcript_path;

    const norm: NormalizedEvent = {
      seq, ts,
      sessionId: sid,
      cwd: rv.cwd,
      parentSessionId: rv.parent_session_id,
      kind: rv.hook_event_name,
      toolName: rv.tool_name,
      toolUseId: rv.tool_use_id,
      toolInput: rv.tool_input,
      toolResponse: rv.tool_response
        ? { isError: rv.tool_response.is_error, content: rv.tool_response.content }
        : undefined,
      prompt: rv.prompt,
      agentId: rv.agent_id,
      agentType: rv.agent_type,
      agentModel: rv.model,
      lastAssistantMessage: rv.last_assistant_message,
      redactions,
    };

    rec.recentEvents.push(norm);
    if (rec.recentEvents.length > RECENT_LIMIT) rec.recentEvents.shift();

    // If this event's session_id is a known subagent's child session,
    // attribute tool activity to the SubagentNode on its parent.
    const childMap = this.childToAgent.get(sid);
    const subNode = childMap
      ? this.sessions.get(childMap.parentSid)?.subagents.get(childMap.agentId)
      : undefined;

    switch (rv.hook_event_name) {
      case "SessionStart":
        if (rv.model) rec.model = rv.model;
        break;
      case "PreToolUse":
        if (rv.tool_name === "Task" || rv.tool_name === "Agent") {
          const brief = extractTaskBrief(rv.tool_input);
          if (brief) {
            rec.pendingTaskPrompts.push(brief);
            // Bound the queue. A Task that never spawns a SubagentStart
            // (failed agent) would otherwise leak.
            while (rec.pendingTaskPrompts.length > 8) rec.pendingTaskPrompts.shift();
          }
        }
        if (rv.tool_use_id && rv.tool_name) {
          rec.pendingToolCalls.set(rv.tool_use_id, rv.tool_name);
          // FIFO bound: Map preserves insertion order, so the first key
          // is the oldest. A subagent that crashes mid-tool would leak
          // entries forever otherwise.
          while (rec.pendingToolCalls.size > PENDING_TOOL_LIMIT) {
            const oldest = rec.pendingToolCalls.keys().next().value;
            if (oldest === undefined) break;
            rec.pendingToolCalls.delete(oldest);
          }
        }
        if (subNode && rv.tool_name) subNode.currentTool = rv.tool_name;
        break;
      case "PostToolUse":
        rec.toolCalls++;
        if (rv.tool_use_id) rec.pendingToolCalls.delete(rv.tool_use_id);
        applyScope(rec.scope, rv);
        if (subNode) {
          subNode.toolCallCount++;
          subNode.currentTool = undefined;
        }
        break;
      case "SubagentStart":
        if (rv.agent_id) {
          // SubagentNode attaches to the PARENT session when
          // parent_session_id is provided and differs from sid; otherwise
          // it attaches to the session this event fired on.
          const parentRec = rv.parent_session_id && rv.parent_session_id !== sid
            ? this.ensureSession(rv.parent_session_id, rv.cwd, ts)
            : rec;
          // FIFO: oldest pending Task prompt belongs to this agent.
          // Imperfect (no explicit toolUseId↔agentId link in the hook
          // payload) but reliable in practice for sequential spawns.
          const brief = parentRec.pendingTaskPrompts.shift();
          parentRec.subagents.set(rv.agent_id, {
            agentId: rv.agent_id,
            agentType: rv.agent_type ?? "unknown",
            parentSessionId: rv.parent_session_id,
            startedAt: ts,
            model: rv.model,
            toolCallCount: 0,
            brief,
          });
          // If parent_session_id differs from this event's session_id, the
          // subagent runs on its own session — record the mapping so later
          // tool events can be attributed back to the parent's node.
          if (rv.parent_session_id && rv.parent_session_id !== sid) {
            this.childToAgent.set(sid, {
              parentSid: rv.parent_session_id,
              agentId: rv.agent_id,
            });
          }
        }
        break;
      case "SubagentStop":
        if (rv.agent_id) {
          const node = rec.subagents.get(rv.agent_id);
          if (node) {
            node.endedAt = ts;
            node.lastMessage = rv.last_assistant_message;
            node.currentTool = undefined;
          }
          // Also check if this Stop fires on the child's own session.
          if (subNode) {
            subNode.endedAt = ts;
            subNode.lastMessage = rv.last_assistant_message;
            subNode.currentTool = undefined;
          }
        }
        // Clean up child mapping if this fires on the child session.
        if (childMap) this.childToAgent.delete(sid);
        break;
    }
  }

  snapshot(sessionId: string): SessionSnapshot | undefined {
    const rec = this.sessions.get(sessionId);
    if (!rec) return undefined;
    return {
      sessionId: rec.sessionId,
      cwd: rec.cwd,
      model: rec.model,
      startedAt: rec.startedAt,
      lastEventAt: rec.lastEventAt,
      toolCalls: rec.toolCalls,
      redactions: rec.redactions,
      scope: {
        edited: { ...rec.scope.edited },
        created: [...rec.scope.created],
        deleted: [...rec.scope.deleted],
        read: [...rec.scope.read],
      },
      subagents: Array.from(rec.subagents.values()),
      recentEvents: [...rec.recentEvents],
      context: rec.context ? { ...rec.context } : undefined,
    };
  }

  /** Get a session's transcript path (for the context reader). */
  transcriptPathFor(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.transcriptPath;
  }

  /** Get the session's model (for context-limit resolution). */
  modelFor(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.model;
  }

  /** Update the context-window occupancy for a session. */
  setContext(sessionId: string, context: SessionSnapshot["context"]): void {
    const rec = this.sessions.get(sessionId);
    if (rec) rec.context = context;
  }

  /** Drop sessions whose last activity is older than `now - sessionTtlMs`.
   *  Returns the number of sessions dropped. Safe to call frequently. */
  gcSweep(now: number): number {
    if (this.sessionTtlMs <= 0) return 0;
    const cutoff = now - this.sessionTtlMs;
    let dropped = 0;
    for (const [sid, rec] of this.sessions) {
      if (rec.lastEventAt < cutoff) {
        this.sessions.delete(sid);
        dropped++;
      }
    }
    // Drop child→agent mappings whose parent or child is gone.
    for (const [childSid, { parentSid }] of this.childToAgent) {
      if (!this.sessions.has(childSid) || !this.sessions.has(parentSid)) {
        this.childToAgent.delete(childSid);
      }
    }
    return dropped;
  }

  allSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Returns the SessionRecord for `sid`, creating and storing a fresh one if none exists. */
  private ensureSession(sid: string, cwd: string, ts: number): SessionRecord {
    let rec = this.sessions.get(sid);
    if (!rec) {
      rec = {
        sessionId: sid,
        cwd,
        startedAt: ts,
        lastEventAt: ts,
        toolCalls: 0,
        redactions: 0,
        scope: { edited: {}, created: [], deleted: [], read: [] },
        subagents: new Map(),
        recentEvents: [],
        pendingToolCalls: new Map(),
        pendingTaskPrompts: [],
      };
      this.sessions.set(sid, rec);
    }
    return rec;
  }
}

function applyScope(scope: SessionScope, rv: RawHookEvent) {
  if (rv.tool_response?.is_error) return;
  const input = (rv.tool_input ?? {}) as Record<string, unknown>;

  if (rv.tool_name === "Bash") {
    applyBashScope(scope, input);
    return;
  }

  const path = typeof input.file_path === "string" ? input.file_path : undefined;
  if (!path) return;

  switch (rv.tool_name) {
    case "Edit": {
      const oldStr = typeof input.old_string === "string" ? input.old_string : "";
      const newStr = typeof input.new_string === "string" ? input.new_string : "";
      const { added, removed } = diffLines(oldStr, newStr);
      const existing = scope.edited[path] ?? { added: 0, removed: 0, reviewed: false };
      scope.edited[path] = {
        added: existing.added + added,
        removed: existing.removed + removed,
        reviewed: existing.reviewed,
        // Keep just the latest edit's old/new — multi-edit paths show the
        // most recent change. Cap each side so a 1MB rewrite doesn't blow
        // up the snapshot payload.
        lastDiff: {
          oldStr: capDiffSide(oldStr),
          newStr: capDiffSide(newStr),
        },
      };
      break;
    }
    case "Write": {
      if (!scope.created.includes(path)) scope.created.push(path);
      break;
    }
    case "Read":
    case "Grep": {
      if (!scope.read.includes(path)) scope.read.push(path);
      break;
    }
  }
}

function applyBashScope(scope: SessionScope, input: Record<string, unknown>): void {
  const cmd = typeof input.command === "string" ? input.command : undefined;
  if (!cmd) return;
  const mut = parseBashMutations(cmd);
  for (const p of mut.created) {
    if (!scope.created.includes(p)) scope.created.push(p);
  }
  for (const p of mut.deleted) {
    if (!scope.deleted.includes(p)) scope.deleted.push(p);
  }
  for (const p of mut.edited) {
    // Bash edits don't expose line counts; record an entry so the path shows
    // up in the scope card with (0,0). Better to know the file was touched
    // than to hide it because we can't measure the delta.
    if (!scope.edited[p]) scope.edited[p] = { added: 0, removed: 0, reviewed: false };
  }
}

// Line-level diff using LCS. Returns the number of lines unique to each side
// (the `+` and `-` counts a `git diff` would print). Identical strings give
// `{added: 0, removed: 0}`.
export function diffLines(oldStr: string, newStr: string): { added: number; removed: number } {
  if (oldStr === newStr) return { added: 0, removed: 0 };
  const a = oldStr === "" ? [] : oldStr.split("\n");
  const b = newStr === "" ? [] : newStr.split("\n");
  const m = a.length, n = b.length;
  // Two-row LCS for O(min(m,n)) memory.
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const lcs = prev[n];
  return { added: n - lcs, removed: m - lcs };
}

/** Extract a short "brief" string from a Task/Agent tool_input. Honors
 *  `prompt` first, then `description`. Returns the first line, capped. */
function extractTaskBrief(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const raw = typeof i.prompt === "string" ? i.prompt
            : typeof i.description === "string" ? i.description
            : undefined;
  if (!raw) return undefined;
  const firstLine = raw.split("\n")[0].trim();
  return firstLine.length > 200 ? firstLine.slice(0, 200) + "…" : firstLine;
}

const DIFF_SIDE_CAP = 4096;
function capDiffSide(s: string): string {
  return s.length > DIFF_SIDE_CAP ? s.slice(0, DIFF_SIDE_CAP) + "\n…[truncated]" : s;
}

