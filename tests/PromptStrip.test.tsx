// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PromptStrip } from "../web/src/components/PromptStrip.js";
import type { SessionSnapshot, NormalizedEvent } from "../web/src/types.js";

const NOW = Date.now();
const ev = (over: Partial<NormalizedEvent>): NormalizedEvent => ({
  seq: 1, ts: NOW, sessionId: "s1", cwd: "/x",
  kind: "UserPromptSubmit", redactions: 0, ...over,
});
const snap = (events: NormalizedEvent[]): SessionSnapshot => ({
  sessionId: "s1", cwd: "/x", startedAt: NOW - 60_000, lastEventAt: NOW,
  toolCalls: 0, redactions: 0,
  scope: { edited: {}, created: [], deleted: [], read: [] },
  subagents: [], recentEvents: events,
});

describe("PromptStrip", () => {
  it("renders nothing without a snapshot", () => {
    const { container } = render(<PromptStrip snapshot={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing if no UserPromptSubmit is in recentEvents", () => {
    const { container } = render(<PromptStrip snapshot={snap([
      ev({ kind: "PreToolUse", toolName: "Read" }),
    ])} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the most recent prompt's first line", () => {
    render(<PromptStrip snapshot={snap([
      ev({ seq: 1, ts: NOW - 10_000, prompt: "old prompt" }),
      ev({ seq: 2, ts: NOW - 5_000, prompt: "fix the auth bug\nin middleware.ts" }),
    ])} />);
    expect(screen.getByText("fix the auth bug")).toBeInTheDocument();
    // Second line not displayed inline.
    expect(screen.queryByText(/middleware\.ts/)).toBeNull();
  });

  it("truncates long single-line prompts", () => {
    const long = "x".repeat(500);
    render(<PromptStrip snapshot={snap([ev({ prompt: long })])} />);
    const text = screen.getByText(/x{50,}/);
    expect(text.textContent!.length).toBeLessThanOrEqual(201);
    expect(text.textContent).toMatch(/…$/);
  });
});
