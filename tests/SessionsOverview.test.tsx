// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionsOverview } from "../web/src/components/SessionsOverview.js";
import type { SessionSnapshot } from "../web/src/types.js";

const NOW = Date.now();
const snap = (id: string, cwd: string, lastEventAt: number, toolCalls = 0): SessionSnapshot => ({
  sessionId: id, cwd, startedAt: NOW - 60_000, lastEventAt,
  toolCalls, redactions: 0,
  scope: { edited: {}, created: [], deleted: [], read: [] },
  subagents: [], recentEvents: [],
});

describe("SessionsOverview", () => {
  it("renders nothing for ≤1 session", () => {
    const { container } = render(
      <SessionsOverview snapshots={new Map([["s1", snap("s1", "/a", NOW)]])}
                        selectedSessionId="s1" onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one tile per session, most-recent first", () => {
    const m = new Map([
      ["older", snap("older", "/projects/old", NOW - 10_000, 3)],
      ["newer", snap("newer", "/projects/new", NOW - 1_000, 7)],
    ]);
    render(<SessionsOverview snapshots={m} selectedSessionId="older" onSelect={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    // First tile is the most recent.
    expect(tabs[0].textContent).toContain("new");
    expect(tabs[1].textContent).toContain("old");
  });

  it("marks the selected tile via aria-selected", () => {
    const m = new Map([
      ["a", snap("a", "/p/a", NOW)],
      ["b", snap("b", "/p/b", NOW - 1)],
    ]);
    render(<SessionsOverview snapshots={m} selectedSessionId="b" onSelect={() => {}} />);
    const selected = screen.getAllByRole("tab", { selected: true });
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("b");
  });

  it("calls onSelect with the clicked session id", () => {
    const onSelect = vi.fn();
    const m = new Map([
      ["a", snap("a", "/p/a", NOW)],
      ["b", snap("b", "/p/b", NOW - 1)],
    ]);
    render(<SessionsOverview snapshots={m} selectedSessionId="a" onSelect={onSelect} />);
    fireEvent.click(screen.getAllByRole("tab")[1]);  // second tile = older = "b"
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
