import { useEffect, useState } from "react";
import type { SessionSnapshot } from "../types.js";
import { sessionStatus, type Status } from "../lib/sessionStatus.js";

interface Props { snapshot?: SessionSnapshot }

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const GLYPH: Record<Status["kind"], string> = {
  no_session: "○",
  working:    "●",
  thinking:   "✴",
  stuck:      "⚠",
  errored:    "⛔",
  idle:       "○",
  done:       "✓",
};

const LABEL: Record<Status["kind"], string> = {
  no_session: "WAITING",
  working:    "WORKING",
  thinking:   "THINKING",
  stuck:      "STUCK",
  errored:    "ERRORED",
  idle:       "IDLE",
  done:       "DONE",
};

function fmtAge(ms: number): string {
  if (ms < 1000) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

export function StatusBadge({ snapshot }: Props) {
  const now = useNow(1000);
  const status = sessionStatus(snapshot, now);

  const cls = `status-badge ${status.kind}`;
  const age = status.kind === "no_session" ? "" : fmtAge(status.ageMs);

  return (
    <div className={cls} role="status" aria-live="polite">
      <span className="glyph" aria-hidden="true">{GLYPH[status.kind]}</span>
      <span className="word">{LABEL[status.kind]}</span>
      {age && <span className="age">{age}</span>}
      {status.kind === "working" && status.currentTool && (
        <span className="detail">{status.currentTool}</span>
      )}
      {status.kind === "stuck" && (
        <span className="loop-chip">LOOP: {status.loopLabel}</span>
      )}
      {status.kind === "errored" && status.toolName && (
        <span className="detail">{status.toolName} failed</span>
      )}
    </div>
  );
}
