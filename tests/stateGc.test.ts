import { describe, it, expect } from "vitest";
import { SessionStateStore } from "../src/state.js";
import type { RawHookEvent } from "../src/types.js";

const evt = (sid: string, kind: RawHookEvent["hook_event_name"], extra: Partial<RawHookEvent> = {}): RawHookEvent =>
  ({ hook_event_name: kind, session_id: sid, cwd: "/x", ...extra } as RawHookEvent);

describe("SessionStateStore GC", () => {
  it("drops sessions inactive past sessionTtlMs", () => {
    const store = new SessionStateStore({ sessionTtlMs: 1000 });
    store.ingest(evt("s1", "SessionStart"), 1, 1_000);
    store.ingest(evt("s2", "SessionStart"), 2, 1_500);
    store.ingest(evt("s3", "SessionStart"), 3, 2_000);

    // Sweep at t=2500: s1's lastEventAt=1000 → cutoff=1500 → s1 dropped.
    expect(store.gcSweep(2_500)).toBe(1);
    expect(store.allSessionIds().sort()).toEqual(["s2", "s3"]);

    // Sweep at t=3500: s2 (1500) and s3 (2000) both older than cutoff 2500.
    expect(store.gcSweep(3_500)).toBe(2);
    expect(store.allSessionIds()).toEqual([]);
  });

  it("ttl=0 disables GC", () => {
    const store = new SessionStateStore({ sessionTtlMs: 0 });
    store.ingest(evt("s1", "SessionStart"), 1, 0);
    expect(store.gcSweep(Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(store.allSessionIds()).toEqual(["s1"]);
  });

  it("clears childToAgent mappings when parent is GC'd", () => {
    const store = new SessionStateStore({ sessionTtlMs: 1000 });
    store.ingest(evt("parent", "SessionStart"), 1, 1_000);
    store.ingest(evt("child", "SubagentStart", {
      agent_id: "a1", agent_type: "x", parent_session_id: "parent",
    }), 2, 1_100);
    // Both parent and child sessions exist.
    expect(store.allSessionIds().sort()).toEqual(["child", "parent"]);

    // GC at t=2200 → parent (1000) and child (1100) both expire.
    store.gcSweep(2_200);
    // Subsequent tool event on a totally fresh session should not dredge up
    // any stale mapping.
    store.ingest(evt("fresh", "SessionStart"), 3, 3_000);
    const snap = store.snapshot("fresh")!;
    expect(snap.subagents).toEqual([]);
  });

  it("bounds pendingToolCalls under sustained Pre-without-Post", () => {
    const store = new SessionStateStore();
    for (let i = 0; i < 1000; i++) {
      store.ingest(evt("s1", "PreToolUse", {
        tool_use_id: `t${i}`, tool_name: "Bash",
      }), i, 1_000 + i);
    }
    // No direct accessor; verify via private field for the test.
    // Reach into the internals: cast through unknown.
    const internalSessions = (store as unknown as {
      sessions: Map<string, { pendingToolCalls: Map<string, string> }>;
    }).sessions;
    const pending = internalSessions.get("s1")!.pendingToolCalls;
    expect(pending.size).toBeLessThanOrEqual(256);
    // Newest entry survived; oldest evicted.
    expect(pending.has("t999")).toBe(true);
    expect(pending.has("t0")).toBe(false);
  });
});
