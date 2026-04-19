import { useEffect, useState } from "react";
import type { SessionSnapshot } from "../types.js";
import { sessionStatus, type Status } from "../lib/sessionStatus.js";

interface Props {
  snapshots: Map<string, SessionSnapshot>;
  selectedSessionId?: string;
  onSelect: (sessionId: string) => void;
}

const STATUS_GLYPH: Record<Status["kind"], string> = {
  no_session: "○", working: "●", thinking: "✴",
  stuck: "⚠", errored: "⛔", idle: "○", done: "✓",
};

function fmtAge(ms: number): string {
  if (ms < 1000) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Tile strip showing every known session as a compact card.
 *  Hidden when ≤1 session — the regular topbar already conveys the info. */
export function SessionsOverview({ snapshots, selectedSessionId, onSelect }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (snapshots.size <= 1) return null;
  const sorted = Array.from(snapshots.values()).sort((a, b) => b.lastEventAt - a.lastEventAt);

  return (
    <div className="sessions-overview" role="tablist" aria-label="Sessions">
      {sorted.map((s) => {
        const status = sessionStatus(s, now);
        const isSelected = s.sessionId === selectedSessionId;
        const cls = `session-tile ${status.kind}${isSelected ? " selected" : ""}`;
        return (
          <button
            key={s.sessionId}
            className={cls}
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(s.sessionId)}
            title={`${s.cwd} · ${s.sessionId}`}
          >
            <span className="tile-glyph" aria-hidden="true">{STATUS_GLYPH[status.kind]}</span>
            <span className="tile-body">
              <span className="tile-cwd">{basenameOf(s.cwd)}</span>
              <span className="tile-meta">
                {s.toolCalls} tools · {fmtAge(now - s.lastEventAt)} ago
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
