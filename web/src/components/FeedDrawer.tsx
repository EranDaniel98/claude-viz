import { useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "../types.js";
import { LiveActivity } from "./LiveActivity.js";
import { sessionStatus } from "../lib/sessionStatus.js";
import { mergeFeedEvents } from "../lib/mergeFeed.js";

interface Props { snapshot?: SessionSnapshot }

/** Wraps LiveActivity in a collapsible drawer that auto-opens on STUCK / ERRORED. */
export function FeedDrawer({ snapshot }: Props) {
  const [open, setOpen] = useState(false);
  const [autoReason, setAutoReason] = useState<string | null>(null);
  const prevAutoKindRef = useRef<string | null>(null);

  // Auto-expand when status flips to stuck or errored.
  useEffect(() => {
    if (!snapshot) return;
    const status = sessionStatus(snapshot, Date.now());
    const isBad = status.kind === "stuck" || status.kind === "errored";
    const wasBad = prevAutoKindRef.current === "stuck" || prevAutoKindRef.current === "errored";
    if (isBad && !wasBad) {
      setOpen(true);
      setAutoReason(status.kind === "stuck"
        ? `STUCK: ${"loopLabel" in status ? status.loopLabel : ""}`
        : `ERRORED${"toolName" in status && status.toolName ? `: ${status.toolName}` : ""}`);
    }
    prevAutoKindRef.current = status.kind;
  }, [snapshot]);

  const eventCount = snapshot ? mergeFeedEvents(snapshot.recentEvents).length : 0;

  return (
    <section className="drawer" aria-label="Activity feed">
      <button
        className="drawer-toggle"
        aria-expanded={open}
        onClick={() => { setOpen((v) => !v); if (open) setAutoReason(null); }}
      >
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span>Activity ({eventCount} {eventCount === 1 ? "event" : "events"})</span>
        {autoReason && open && (
          <span className="auto-reason" aria-live="polite">⛔ auto-opened: {autoReason}</span>
        )}
      </button>
      {open && (
        <div className="drawer-body">
          <LiveActivity snapshot={snapshot} />
        </div>
      )}
    </section>
  );
}
