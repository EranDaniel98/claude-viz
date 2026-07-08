import { describe, it, expect } from "vitest";
import { mergeFeedEvents } from "../web/src/lib/mergeFeed.js";
import type { NormalizedEvent } from "../web/src/types.js";

const ev = (over: Partial<NormalizedEvent> & { seq: number; kind: string }): NormalizedEvent => ({
  ts: over.seq * 1000,
  sessionId: "s1",
  cwd: "/x",
  redactions: 0,
  ...over,
});

describe("mergeFeedEvents", () => {
  it("passes through non-tool events unchanged", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "SubagentStart", agentId: "a", agentType: "explorer" }),
      ev({ seq: 2, kind: "SubagentStop", agentId: "a" }),
    ];
    const rows = mergeFeedEvents(events);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ kind: "event", event: events[0] });
    expect(rows[1]).toEqual({ kind: "event", event: events[1] });
  });

  it("drops SessionStart events entirely", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "SessionStart" }),
      ev({ seq: 2, kind: "SubagentStart", agentId: "a", agentType: "x" }),
    ];
    const rows = mergeFeedEvents(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ kind: "event", event: events[1] });
  });

  it("converts UserPromptSubmit into a prompt row with the first line", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "UserPromptSubmit", prompt: "fix the bug\nmore context here" }),
    ];
    const rows = mergeFeedEvents(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      kind: "prompt",
      seq: 1,
      ts: 1000,
      text: "fix the bug",
    });
  });

  it("treats a UserPromptSubmit with no prompt as an empty prompt row", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "UserPromptSubmit" }),
    ];
    const rows = mergeFeedEvents(events);
    expect(rows[0]).toEqual({ kind: "prompt", seq: 1, ts: 1000, text: "" });
  });

  it("keeps a lone Pre as a pending tool row", () => {
    const pre = ev({
      seq: 1, kind: "PreToolUse", toolName: "Bash", toolUseId: "t1",
      toolInput: { command: "npm test" },
    });
    const rows = mergeFeedEvents([pre]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "tool", toolUseId: "t1", isPending: true, startedAt: 1000,
    });
    const row = rows[0] as Extract<typeof rows[0], { kind: "tool" }>;
    expect(row.endedAt).toBeUndefined();
    expect(row.durationMs).toBeUndefined();
  });

  it("records isError=true when the Post response is an error", () => {
    const pre = ev({ seq: 1, kind: "PreToolUse", toolName: "Read", toolUseId: "t1" });
    const post = ev({
      seq: 2, kind: "PostToolUse", toolName: "Read", toolUseId: "t1",
      toolResponse: { isError: true, content: "ENOENT" },
    });
    const rows = mergeFeedEvents([pre, post]);
    expect(rows[0]).toMatchObject({ kind: "tool", isError: true, isPending: false });
  });

  it("merges interleaved pairs and preserves start order", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "PreToolUse", toolName: "Read", toolUseId: "a" }),
      ev({ seq: 2, kind: "PreToolUse", toolName: "Grep", toolUseId: "b" }),
      ev({ seq: 3, kind: "PostToolUse", toolName: "Grep", toolUseId: "b" }),
      ev({ seq: 4, kind: "PostToolUse", toolName: "Read", toolUseId: "a" }),
    ];
    const rows = mergeFeedEvents(events);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "tool", toolUseId: "a", isPending: false });
    expect(rows[1]).toMatchObject({ kind: "tool", toolUseId: "b", isPending: false });
  });

  it("handles a Post without a preceding Pre as a best-effort completed row", () => {
    const post = ev({
      seq: 5, kind: "PostToolUse", toolName: "Edit", toolUseId: "orphan",
      toolResponse: { isError: false },
    });
    const rows = mergeFeedEvents([post]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "tool", toolUseId: "orphan", toolName: "Edit", isPending: false,
    });
  });

  it("interleaves prompt, tool, and passthrough rows in order", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "UserPromptSubmit", prompt: "go" }),
      ev({ seq: 2, kind: "PreToolUse", toolName: "Read", toolUseId: "a" }),
      ev({ seq: 3, kind: "PostToolUse", toolName: "Read", toolUseId: "a" }),
      ev({ seq: 4, kind: "SubagentStart", agentId: "x" }),
    ];
    const rows = mergeFeedEvents(events);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "prompt", text: "go" });
    expect(rows[1]).toMatchObject({ kind: "tool", toolUseId: "a" });
    expect(rows[2]).toEqual({ kind: "event", event: events[3] });
  });

  it("collapses 3+ consecutive Read/Grep/Glob tool calls within 20s into one exploration row", () => {
    const events: NormalizedEvent[] = [];
    let seq = 0;
    const pair = (kind: string, toolName: string, toolUseId: string, path: string) => {
      seq++; events.push(ev({ seq, kind: "PreToolUse",  toolName, toolUseId, toolInput: { file_path: path } }));
      seq++; events.push(ev({ seq, kind: "PostToolUse", toolName, toolUseId, toolInput: { file_path: path },
                              toolResponse: { isError: false } }));
    };
    pair("PreToolUse", "Read", "a", "/x/a.ts");
    pair("PreToolUse", "Grep", "b", "/x/b.ts");
    pair("PreToolUse", "Read", "c", "/x/c.ts");

    const rows = mergeFeedEvents(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "exploration",
      count: 3,
    });
    expect((rows[0] as { paths: string[] }).paths).toHaveLength(3);
  });

  it("does NOT collapse if fewer than 3 exploration tools run", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "PreToolUse",  toolName: "Read", toolUseId: "a" }),
      ev({ seq: 2, kind: "PostToolUse", toolName: "Read", toolUseId: "a" }),
      ev({ seq: 3, kind: "PreToolUse",  toolName: "Read", toolUseId: "b" }),
      ev({ seq: 4, kind: "PostToolUse", toolName: "Read", toolUseId: "b" }),
    ];
    const rows = mergeFeedEvents(events);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "tool" });
    expect(rows[1]).toMatchObject({ kind: "tool" });
  });

  it("does NOT collapse when the gap between tools exceeds 20s", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, ts: 0,     kind: "PreToolUse",  toolName: "Read", toolUseId: "a" }),
      ev({ seq: 2, ts: 100,   kind: "PostToolUse", toolName: "Read", toolUseId: "a" }),
      ev({ seq: 3, ts: 25000, kind: "PreToolUse",  toolName: "Read", toolUseId: "b" }),
      ev({ seq: 4, ts: 25100, kind: "PostToolUse", toolName: "Read", toolUseId: "b" }),
      ev({ seq: 5, ts: 26000, kind: "PreToolUse",  toolName: "Read", toolUseId: "c" }),
      ev({ seq: 6, ts: 26100, kind: "PostToolUse", toolName: "Read", toolUseId: "c" }),
    ];
    const rows = mergeFeedEvents(events);
    // First Read is alone (25s gap after it), then 2 more reads within window — still not 3 in a run
    expect(rows.every((r) => r.kind === "tool")).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it("breaks an exploration run when an Edit interrupts", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "PreToolUse",  toolName: "Read", toolUseId: "a" }),
      ev({ seq: 2, kind: "PostToolUse", toolName: "Read", toolUseId: "a" }),
      ev({ seq: 3, kind: "PreToolUse",  toolName: "Read", toolUseId: "b" }),
      ev({ seq: 4, kind: "PostToolUse", toolName: "Read", toolUseId: "b" }),
      ev({ seq: 5, kind: "PreToolUse",  toolName: "Edit", toolUseId: "e" }),
      ev({ seq: 6, kind: "PostToolUse", toolName: "Edit", toolUseId: "e" }),
      ev({ seq: 7, kind: "PreToolUse",  toolName: "Read", toolUseId: "c" }),
      ev({ seq: 8, kind: "PostToolUse", toolName: "Read", toolUseId: "c" }),
    ];
    const rows = mergeFeedEvents(events);
    expect(rows).toHaveLength(4); // 2 reads + edit + 1 read (none of 3 consecutive)
    expect(rows.every((r) => r.kind === "tool")).toBe(true);
  });

  it("skips collapse when an exploration tool errored", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "PreToolUse",  toolName: "Read", toolUseId: "a" }),
      ev({ seq: 2, kind: "PostToolUse", toolName: "Read", toolUseId: "a" }),
      ev({ seq: 3, kind: "PreToolUse",  toolName: "Read", toolUseId: "b" }),
      ev({ seq: 4, kind: "PostToolUse", toolName: "Read", toolUseId: "b",
           toolResponse: { isError: true, content: "ENOENT" } }),
      ev({ seq: 5, kind: "PreToolUse",  toolName: "Read", toolUseId: "c" }),
      ev({ seq: 6, kind: "PostToolUse", toolName: "Read", toolUseId: "c" }),
    ];
    const rows = mergeFeedEvents(events);
    // Error breaks collapse so errors remain visible in the feed
    expect(rows.every((r) => r.kind === "tool")).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it("converts Stop into a turn_end row with tool and edit counts since last prompt", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "UserPromptSubmit", prompt: "go" }),
      ev({ seq: 2, kind: "PreToolUse",  toolName: "Read", toolUseId: "a" }),
      ev({ seq: 3, kind: "PostToolUse", toolName: "Read", toolUseId: "a" }),
      ev({ seq: 4, kind: "PreToolUse",  toolName: "Edit", toolUseId: "b" }),
      ev({ seq: 5, kind: "PostToolUse", toolName: "Edit", toolUseId: "b" }),
      ev({ seq: 6, kind: "Stop" }),
    ];
    const rows = mergeFeedEvents(events);
    expect(rows[rows.length - 1]).toEqual({
      kind: "turn_end",
      seq: 6,
      ts: 6000,
      durationMs: 5000,
      toolCount: 2,
      editCount: 1,
    });
  });

  it("turn_end with no preceding prompt uses undefined duration", () => {
    const events: NormalizedEvent[] = [
      ev({ seq: 1, kind: "PreToolUse",  toolName: "Read", toolUseId: "a" }),
      ev({ seq: 2, kind: "PostToolUse", toolName: "Read", toolUseId: "a" }),
      ev({ seq: 3, kind: "Stop" }),
    ];
    const rows = mergeFeedEvents(events);
    const end = rows[rows.length - 1];
    expect(end).toMatchObject({ kind: "turn_end", toolCount: 1, editCount: 0 });
    expect((end as { durationMs?: number }).durationMs).toBeUndefined();
  });

  it("merges a Pre+Post pair into one completed tool row", () => {
    const pre = ev({
      seq: 1, kind: "PreToolUse", toolName: "Edit", toolUseId: "t1",
      toolInput: { file_path: "/x/a.ts" },
    });
    const post = ev({
      seq: 2, kind: "PostToolUse", toolName: "Edit", toolUseId: "t1",
      toolInput: { file_path: "/x/a.ts" },
      toolResponse: { isError: false },
    });
    const rows = mergeFeedEvents([pre, post]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "tool",
      toolUseId: "t1",
      toolName: "Edit",
      isPending: false,
      isError: false,
      startedAt: 1000,
      endedAt: 2000,
      durationMs: 1000,
    });
  });
});
