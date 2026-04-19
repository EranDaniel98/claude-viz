import { describe, it, expect } from "vitest";
import { sessionStatus } from "../web/src/lib/sessionStatus.js";
import type { NormalizedEvent, SessionSnapshot } from "../web/src/types.js";

const ev = (over: Partial<NormalizedEvent> & { seq: number; kind: string }): NormalizedEvent => ({
  ts: over.seq * 1000,
  sessionId: "s1",
  cwd: "/x",
  redactions: 0,
  ...over,
});

const snap = (events: NormalizedEvent[], lastEventAt?: number): SessionSnapshot => ({
  sessionId: "s1",
  cwd: "/x",
  startedAt: 0,
  lastEventAt: lastEventAt ?? (events.length ? events[events.length - 1].ts : 0),
  toolCalls: 0,
  redactions: 0,
  scope: { edited: {}, created: [], deleted: [], read: [] },
  subagents: [],
  recentEvents: events,
});

describe("sessionStatus", () => {
  it("returns no_session when there is no snapshot", () => {
    expect(sessionStatus(undefined, 0)).toEqual({ kind: "no_session" });
  });

  it("returns WORKING with current tool when a PreToolUse has no matching Post", () => {
    const events = [
      ev({ seq: 1, kind: "PreToolUse", toolName: "Bash", toolUseId: "t1",
           toolInput: { command: "npm test" } }),
    ];
    const s = sessionStatus(snap(events), 5000);
    expect(s).toMatchObject({ kind: "working", ageMs: 4000, currentTool: "Bash" });
  });

  it("returns THINKING when last event was a completed tool and age is short", () => {
    const events = [
      ev({ seq: 1, kind: "PreToolUse",  toolName: "Read", toolUseId: "t1" }),
      ev({ seq: 2, kind: "PostToolUse", toolName: "Read", toolUseId: "t1",
           toolResponse: { isError: false } }),
    ];
    const s = sessionStatus(snap(events), 10_000);
    expect(s).toMatchObject({ kind: "thinking", ageMs: 8000 });
  });

  it("returns ERRORED when the most-recent PostToolUse errored and nothing newer succeeded", () => {
    const events = [
      ev({ seq: 1, kind: "PreToolUse",  toolName: "Edit", toolUseId: "t1" }),
      ev({ seq: 2, kind: "PostToolUse", toolName: "Edit", toolUseId: "t1",
           toolResponse: { isError: true, content: "old_string not found" } }),
    ];
    const s = sessionStatus(snap(events), 5000);
    expect(s).toMatchObject({ kind: "errored", ageMs: 3000 });
  });

  it("returns STUCK when same tool+input fires 3+ times with is_error=true in 60s", () => {
    const input = { file_path: "/x/a.ts", old_string: "foo", new_string: "bar" };
    const events: NormalizedEvent[] = [];
    for (let i = 0; i < 3; i++) {
      events.push(ev({ seq: i*2+1, kind: "PreToolUse", toolName: "Edit", toolUseId: `t${i}`, toolInput: input }));
      events.push(ev({ seq: i*2+2, kind: "PostToolUse", toolName: "Edit", toolUseId: `t${i}`, toolInput: input,
                      toolResponse: { isError: true, content: "fail" } }));
    }
    const s = sessionStatus(snap(events), 7000);
    expect(s).toMatchObject({ kind: "stuck", ageMs: 1000 });
    expect((s as { loopLabel: string }).loopLabel).toContain("Edit");
    expect((s as { loopLabel: string }).loopLabel).toContain("×3");
  });

  it("does NOT flag STUCK when retries have different inputs", () => {
    const events: NormalizedEvent[] = [];
    for (let i = 0; i < 3; i++) {
      events.push(ev({ seq: i*2+1, kind: "PreToolUse", toolName: "Edit", toolUseId: `t${i}`,
                      toolInput: { file_path: `/x/${i}.ts`, old_string: "a", new_string: "b" } }));
      events.push(ev({ seq: i*2+2, kind: "PostToolUse", toolName: "Edit", toolUseId: `t${i}`,
                      toolInput: { file_path: `/x/${i}.ts`, old_string: "a", new_string: "b" },
                      toolResponse: { isError: true } }));
    }
    const s = sessionStatus(snap(events), 7000);
    expect(s.kind).not.toBe("stuck");
  });

  it("returns IDLE when last event is older than the idle threshold (30s)", () => {
    const events = [
      ev({ seq: 1, kind: "PreToolUse",  toolName: "Read", toolUseId: "t1" }),
      ev({ seq: 2, kind: "PostToolUse", toolName: "Read", toolUseId: "t1",
           toolResponse: { isError: false } }),
    ];
    const s = sessionStatus(snap(events), 40_000);
    expect(s).toMatchObject({ kind: "idle", ageMs: 38_000 });
  });

  it("returns DONE when last event is Stop and nothing newer", () => {
    const events = [
      ev({ seq: 1, kind: "UserPromptSubmit", prompt: "go" }),
      ev({ seq: 2, kind: "PreToolUse",  toolName: "Read", toolUseId: "t1" }),
      ev({ seq: 3, kind: "PostToolUse", toolName: "Read", toolUseId: "t1",
           toolResponse: { isError: false } }),
      ev({ seq: 4, kind: "Stop" }),
    ];
    const s = sessionStatus(snap(events), 10_000);
    expect(s).toMatchObject({ kind: "done", ageMs: 6000 });
  });
});
