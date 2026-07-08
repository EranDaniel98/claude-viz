// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../web/src/components/StatusBadge.js";
import type { SessionSnapshot, NormalizedEvent } from "../web/src/types.js";

const NOW = Date.now();

const ev = (over: Partial<NormalizedEvent>): NormalizedEvent => ({
  seq: 1,
  ts: NOW,
  sessionId: "s1",
  cwd: "/x",
  kind: "PostToolUse",
  redactions: 0,
  ...over,
});

const snap = (events: NormalizedEvent[], lastEventAt = NOW): SessionSnapshot => ({
  sessionId: "s1",
  cwd: "/x",
  startedAt: NOW - 60_000,
  lastEventAt,
  toolCalls: events.filter((e) => e.kind === "PostToolUse").length,
  redactions: 0,
  scope: { edited: {}, created: [], deleted: [], read: [] },
  subagents: [],
  recentEvents: events,
});

describe("StatusBadge", () => {
  it('renders "no session" badge when snapshot is missing', () => {
    render(<StatusBadge snapshot={undefined} />);
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });

  it('renders "working" badge when a Pre is unmatched by Post', () => {
    const events = [ev({ kind: "PreToolUse", toolUseId: "t1", toolName: "Bash" })];
    render(<StatusBadge snapshot={snap(events)} />);
    expect(screen.getByText(/working/i)).toBeInTheDocument();
  });

  it('renders "errored" badge after a failed Post with no recovery', () => {
    const events = [
      ev({ kind: "PreToolUse", toolUseId: "t1", toolName: "Bash" }),
      ev({ kind: "PostToolUse", toolUseId: "t1", toolName: "Bash",
           toolResponse: { isError: true } }),
    ];
    render(<StatusBadge snapshot={snap(events)} />);
    expect(screen.getByText(/errored/i)).toBeInTheDocument();
  });

  it('renders "done" badge when Stop is the last event', () => {
    const events = [
      ev({ kind: "PreToolUse", toolUseId: "t1", toolName: "Read" }),
      ev({ kind: "PostToolUse", toolUseId: "t1", toolName: "Read" }),
      ev({ kind: "Stop" }),
    ];
    render(<StatusBadge snapshot={snap(events)} />);
    expect(screen.getByText(/done/i)).toBeInTheDocument();
  });
});
