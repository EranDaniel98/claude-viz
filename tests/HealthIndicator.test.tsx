// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthIndicator } from "../web/src/components/HealthIndicator.js";
import type { Health } from "../web/src/useHealth.js";

const baseHealth = (over: Partial<Health> = {}): Health => ({
  eventsFile: "C:/Users/x/.claude-viz/events.jsonl",
  fileExists: true,
  lastMtimeMs: Date.now(),
  lastEventReceivedAt: Date.now(),
  eventsSeenCount: 5,
  sessionCount: 1,
  ...over,
});

describe("HealthIndicator", () => {
  it("renders nothing without health data", () => {
    const { container } = render(<HealthIndicator health={undefined} connected={true} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "no events yet" when WS is up but no events have arrived', () => {
    render(<HealthIndicator health={baseHealth({ eventsSeenCount: 0 })} connected={true} />);
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });

  it('shows "events stale" when file mtime is older than threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const stale = Date.now() - 90_000;  // 90s old, threshold is 60s
    render(<HealthIndicator
      health={baseHealth({ lastMtimeMs: stale, eventsSeenCount: 5 })}
      connected={true}
    />);
    expect(screen.getByText(/events stale/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows the events file basename when healthy", () => {
    render(<HealthIndicator health={baseHealth()} connected={true} />);
    expect(screen.getByText(/events\.jsonl/)).toBeInTheDocument();
  });
});
