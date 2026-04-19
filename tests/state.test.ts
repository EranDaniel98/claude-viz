import { describe, it, expect } from "vitest";
import { SessionStateStore } from "../src/state.js";
import type { RawHookEvent } from "../src/types.js";

const base = (partial: Partial<RawHookEvent>): RawHookEvent => ({
  hook_event_name: "PreToolUse",
  session_id: "s1",
  cwd: "/tmp/x",
  ...partial,
} as RawHookEvent);

describe("SessionStateStore", () => {
  it("creates a session on SessionStart and tracks cwd/model", () => {
    const store = new SessionStateStore();
    store.ingest(base({ hook_event_name: "SessionStart", model: "opus" }), 1, 1000);
    const snap = store.snapshot("s1");
    expect(snap?.cwd).toBe("/tmp/x");
    expect(snap?.model).toBe("opus");
  });

  it("counts tool calls and records recent events", () => {
    const store = new SessionStateStore();
    store.ingest(base({ hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: "t1" }), 1, 1000);
    store.ingest(base({ hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "t1" }), 2, 1100);
    const snap = store.snapshot("s1")!;
    expect(snap.toolCalls).toBe(1);
    expect(snap.recentEvents.length).toBe(2);
  });

  it("tracks scope: edits, creates, deletes, reads", () => {
    const store = new SessionStateStore();
    store.ingest(base({
      hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: "t1",
      tool_input: { file_path: "/x/a.ts", old_string: "a", new_string: "aa\nbb" },
    }), 1, 1000);
    store.ingest(base({
      hook_event_name: "PostToolUse", tool_name: "Write", tool_use_id: "t2",
      tool_input: { file_path: "/x/b.ts", content: "new file" },
    }), 2, 1100);
    store.ingest(base({
      hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "t3",
      tool_input: { file_path: "/x/c.ts" },
    }), 3, 1200);
    const scope = store.snapshot("s1")!.scope;
    expect(scope.edited["/x/a.ts"]).toMatchObject({ added: 2, removed: 1, reviewed: false });
    expect(scope.created).toContain("/x/b.ts");
    expect(scope.read).toContain("/x/c.ts");
  });

  it("nests subagents under parent via parent_session_id", () => {
    const store = new SessionStateStore();
    store.ingest(base({ hook_event_name: "SessionStart" }), 1, 1000);
    store.ingest(base({
      hook_event_name: "SubagentStart",
      agent_id: "a1", agent_type: "Explore",
      parent_session_id: "s1",
    }), 2, 1100);
    const snap = store.snapshot("s1")!;
    expect(snap.subagents.length).toBe(1);
    expect(snap.subagents[0].agentType).toBe("Explore");
  });

  it("ignores events without session_id", () => {
    const store = new SessionStateStore();
    const evt = { hook_event_name: "PreToolUse", cwd: "/x" } as unknown as RawHookEvent;
    store.ingest(evt, 1, 1000);
    expect(store.snapshot("s1")).toBeUndefined();
  });

  it("applies redaction and counts per-event redactions", () => {
    const store = new SessionStateStore();
    store.ingest(base({
      hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "t1",
      tool_input: { file_path: "/x/.env" },
      tool_response: { content: "AWS_KEY=AKIAIOSFODNN7EXAMPLE" },
    }), 1, 1000);
    const snap = store.snapshot("s1")!;
    expect(snap.redactions).toBeGreaterThan(0);
  });

  it("attributes tool calls on a subagent's own session to its parent's SubagentNode", () => {
    const store = new SessionStateStore();
    store.ingest(base({ hook_event_name: "SessionStart", session_id: "parent" }), 1, 1000);
    store.ingest(base({
      hook_event_name: "SubagentStart",
      session_id: "child",
      parent_session_id: "parent",
      agent_id: "a1",
      agent_type: "Explore",
    }), 2, 1100);
    store.ingest(base({
      hook_event_name: "PreToolUse",
      session_id: "child",
      tool_name: "Bash",
      tool_use_id: "t1",
    }), 3, 1200);
    const snapDuring = store.snapshot("parent")!;
    expect(snapDuring.subagents[0].currentTool).toBe("Bash");
    expect(snapDuring.subagents[0].toolCallCount).toBe(0);

    store.ingest(base({
      hook_event_name: "PostToolUse",
      session_id: "child",
      tool_name: "Bash",
      tool_use_id: "t1",
    }), 4, 1300);
    const snapAfter = store.snapshot("parent")!;
    expect(snapAfter.subagents[0].currentTool).toBeUndefined();
    expect(snapAfter.subagents[0].toolCallCount).toBe(1);
  });
});
