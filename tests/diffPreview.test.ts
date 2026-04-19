import { describe, it, expect } from "vitest";
import { SessionStateStore } from "../src/state.js";
import type { RawHookEvent } from "../src/types.js";

const evt = (over: Partial<RawHookEvent>): RawHookEvent =>
  ({ hook_event_name: "PostToolUse", session_id: "s", cwd: "/x", ...over } as RawHookEvent);

describe("scope.edited.lastDiff", () => {
  it("is populated by Edit tool calls", () => {
    const store = new SessionStateStore();
    store.ingest(evt({
      tool_name: "Edit", tool_use_id: "t1",
      tool_input: { file_path: "/p/a.ts", old_string: "foo", new_string: "bar" },
    }), 1, 1_000);
    const e = store.snapshot("s")!.scope.edited["/p/a.ts"];
    expect(e.lastDiff).toEqual({ oldStr: "foo", newStr: "bar" });
  });

  it("is overwritten by subsequent edits to the same path (latest only)", () => {
    const store = new SessionStateStore();
    store.ingest(evt({
      tool_name: "Edit", tool_use_id: "t1",
      tool_input: { file_path: "/p/a.ts", old_string: "v1", new_string: "v2" },
    }), 1, 1_000);
    store.ingest(evt({
      tool_name: "Edit", tool_use_id: "t2",
      tool_input: { file_path: "/p/a.ts", old_string: "v2", new_string: "v3" },
    }), 2, 1_100);
    expect(store.snapshot("s")!.scope.edited["/p/a.ts"].lastDiff)
      .toEqual({ oldStr: "v2", newStr: "v3" });
  });

  it("is undefined for Bash-driven edits (no source content available)", () => {
    const store = new SessionStateStore();
    store.ingest(evt({
      tool_name: "Bash", tool_use_id: "t1",
      tool_input: { command: "sed -i 's/x/y/' a.ts" },
    }), 1, 1_000);
    const e = store.snapshot("s")!.scope.edited["a.ts"];
    expect(e.lastDiff).toBeUndefined();
  });

  it("caps each side at 4KB to keep snapshot payloads bounded", () => {
    const big = "x".repeat(8_000);
    const store = new SessionStateStore();
    store.ingest(evt({
      tool_name: "Edit", tool_use_id: "t1",
      tool_input: { file_path: "/p/big.txt", old_string: big, new_string: "small" },
    }), 1, 1_000);
    const e = store.snapshot("s")!.scope.edited["/p/big.txt"];
    expect(e.lastDiff!.oldStr.length).toBeLessThanOrEqual(4096 + 32);  // +marker
    expect(e.lastDiff!.oldStr).toContain("[truncated]");
  });
});
