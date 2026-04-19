// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionPicker } from "../web/src/components/SessionPicker.js";
import type { SessionSnapshot } from "../web/src/types.js";

const snap = (id: string, cwd: string, lastEventAt: number): SessionSnapshot => ({
  sessionId: id,
  cwd,
  startedAt: 0,
  lastEventAt,
  toolCalls: 0,
  redactions: 0,
  scope: { edited: {}, created: [], deleted: [], read: [] },
  subagents: [],
  recentEvents: [],
});

describe("SessionPicker", () => {
  it("renders nothing when only one session is known", () => {
    const { container } = render(
      <SessionPicker
        snapshots={new Map([["s1", snap("s1", "/x", 1)]])}
        selectedSessionId="s1"
        onSelect={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a select with one option per session, most-recent first", () => {
    const m = new Map<string, SessionSnapshot>([
      ["older", snap("older", "/projects/a", 100)],
      ["newer", snap("newer", "/projects/b", 200)],
    ]);
    render(
      <SessionPicker snapshots={m} selectedSessionId="older" onSelect={() => {}} />,
    );
    const opts = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(opts).toHaveLength(2);
    // First option is the most recent.
    expect(opts[0].value).toBe("newer");
    expect(opts[1].value).toBe("older");
  });

  it("calls onSelect with the chosen session id", () => {
    const onSelect = vi.fn();
    const m = new Map<string, SessionSnapshot>([
      ["s1", snap("s1", "/a", 100)],
      ["s2", snap("s2", "/b", 50)],
    ]);
    render(<SessionPicker snapshots={m} selectedSessionId="s1" onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "s2" } });
    expect(onSelect).toHaveBeenCalledWith("s2");
  });
});
