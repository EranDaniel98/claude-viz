import { describe, it, expect } from "vitest";
import { SessionStateStore } from "../src/state.js";
import type { RawHookEvent } from "../src/types.js";

const evt = (over: Partial<RawHookEvent>): RawHookEvent =>
  ({ hook_event_name: "PreToolUse", session_id: "p", cwd: "/x", ...over } as RawHookEvent);

describe("Subagent brief attachment", () => {
  it("attaches Task prompt to the SubagentNode that follows", () => {
    const store = new SessionStateStore();
    store.ingest(evt({ hook_event_name: "SessionStart" }), 1, 1_000);
    store.ingest(evt({
      tool_name: "Task", tool_use_id: "task1",
      tool_input: { prompt: "find all places we call refreshToken()", subagent_type: "Explore" },
    }), 2, 1_100);
    store.ingest(evt({
      hook_event_name: "SubagentStart",
      session_id: "child", parent_session_id: "p",
      agent_id: "a1", agent_type: "Explore",
    }), 3, 1_200);
    const snap = store.snapshot("p")!;
    expect(snap.subagents[0].brief).toBe("find all places we call refreshToken()");
  });

  it("uses description when prompt is missing", () => {
    const store = new SessionStateStore();
    store.ingest(evt({ hook_event_name: "SessionStart" }), 1, 1_000);
    store.ingest(evt({
      tool_name: "Agent", tool_use_id: "task1",
      tool_input: { description: "scan codebase for auth bugs" },
    }), 2, 1_100);
    store.ingest(evt({
      hook_event_name: "SubagentStart",
      session_id: "child", parent_session_id: "p",
      agent_id: "a1", agent_type: "general-purpose",
    }), 3, 1_200);
    expect(store.snapshot("p")!.subagents[0].brief).toBe("scan codebase for auth bugs");
  });

  it("only the first line of multi-line prompts is kept", () => {
    const store = new SessionStateStore();
    store.ingest(evt({ hook_event_name: "SessionStart" }), 1, 1_000);
    store.ingest(evt({
      tool_name: "Task",
      tool_input: { prompt: "fix the bug\n\ndetails: ..." },
    }), 2, 1_100);
    store.ingest(evt({
      hook_event_name: "SubagentStart",
      session_id: "child", parent_session_id: "p",
      agent_id: "a1", agent_type: "Explore",
    }), 3, 1_200);
    expect(store.snapshot("p")!.subagents[0].brief).toBe("fix the bug");
  });

  it("FIFO: queued briefs match agents in spawn order", () => {
    const store = new SessionStateStore();
    store.ingest(evt({ hook_event_name: "SessionStart" }), 1, 1_000);
    // Two Task calls before any SubagentStart fires
    store.ingest(evt({ tool_name: "Task", tool_input: { prompt: "first" } }), 2, 1_100);
    store.ingest(evt({ tool_name: "Task", tool_input: { prompt: "second" } }), 3, 1_150);
    store.ingest(evt({ hook_event_name: "SubagentStart",
      session_id: "child1", parent_session_id: "p", agent_id: "a1", agent_type: "Explore",
    }), 4, 1_200);
    store.ingest(evt({ hook_event_name: "SubagentStart",
      session_id: "child2", parent_session_id: "p", agent_id: "a2", agent_type: "Explore",
    }), 5, 1_250);
    const subs = store.snapshot("p")!.subagents;
    expect(subs.find((s) => s.agentId === "a1")?.brief).toBe("first");
    expect(subs.find((s) => s.agentId === "a2")?.brief).toBe("second");
  });

  it("bounds the pending queue at 8 entries", () => {
    const store = new SessionStateStore();
    store.ingest(evt({ hook_event_name: "SessionStart" }), 1, 1_000);
    for (let i = 0; i < 12; i++) {
      store.ingest(evt({ tool_name: "Task", tool_input: { prompt: `task-${i}` } }), 100 + i, 2_000 + i);
    }
    store.ingest(evt({ hook_event_name: "SubagentStart",
      session_id: "child", parent_session_id: "p", agent_id: "a1", agent_type: "Explore",
    }), 200, 3_000);
    // 12 pushed, 8 retained → oldest kept is task-4.
    expect(store.snapshot("p")!.subagents[0].brief).toBe("task-4");
  });
});
