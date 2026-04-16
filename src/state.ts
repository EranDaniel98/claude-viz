import { redactValue } from "./redact.js";
import type {
  NormalizedEvent, RawHookEvent, SessionScope, SessionSnapshot, SubagentNode,
} from "./types.js";

const RECENT_LIMIT = 200;

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
}

export class SessionStateStore {
  private sessions = new Map<string, SessionRecord>();
  // child session_id -> (parent session_id, agent_id) — lets us attribute
  // tool events that fire against a subagent's own session back to the
  // SubagentNode on its parent.
  private childToAgent = new Map<string, { parentSid: string; agentId: string }>();

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
        if (rv.tool_use_id && rv.tool_name) {
          rec.pendingToolCalls.set(rv.tool_use_id, rv.tool_name);
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
          parentRec.subagents.set(rv.agent_id, {
            agentId: rv.agent_id,
            agentType: rv.agent_type ?? "unknown",
            parentSessionId: rv.parent_session_id,
            startedAt: ts,
            model: rv.model,
            toolCallCount: 0,
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
    };
  }

  allSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

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
      };
      this.sessions.set(sid, rec);
    }
    return rec;
  }
}

function applyScope(scope: SessionScope, rv: RawHookEvent) {
  const input = (rv.tool_input ?? {}) as Record<string, unknown>;
  const path = typeof input.file_path === "string" ? input.file_path : undefined;
  if (!path) return;
  if (rv.tool_response?.is_error) return;

  switch (rv.tool_name) {
    case "Edit": {
      const oldStr = typeof input.old_string === "string" ? input.old_string : "";
      const newStr = typeof input.new_string === "string" ? input.new_string : "";
      const added = linesIn(newStr);
      const removed = linesIn(oldStr);
      const existing = scope.edited[path] ?? { added: 0, removed: 0, reviewed: false };
      scope.edited[path] = {
        added: existing.added + added,
        removed: existing.removed + removed,
        reviewed: existing.reviewed,
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

function linesIn(s: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}
