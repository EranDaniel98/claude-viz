import { useEffect, useState } from "react";
import type { NormalizedEvent, SessionSnapshot } from "../types.js";

interface Props { snapshot?: SessionSnapshot }

const MAX_INLINE = 200;

function findLatestPrompt(events: NormalizedEvent[]): NormalizedEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === "UserPromptSubmit" && events[i].prompt) return events[i];
  }
  return undefined;
}

function fmtAge(ms: number): string {
  if (ms < 1000) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

/** Pinned banner showing the user's most recent prompt — answers the
 *  "what is Claude trying to accomplish right now?" question that
 *  StatusBadge alone can't. Shows only the first line; full text on hover. */
export function PromptStrip({ snapshot }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!snapshot) return null;
  const latest = findLatestPrompt(snapshot.recentEvents);
  if (!latest || !latest.prompt) return null;

  const firstLine = latest.prompt.split("\n")[0];
  const display = firstLine.length > MAX_INLINE
    ? firstLine.slice(0, MAX_INLINE) + "…"
    : firstLine;

  return (
    <div className="prompt-strip" role="region" aria-label="Active prompt" title={latest.prompt}>
      <span className="prompt-glyph" aria-hidden="true">›</span>
      <span className="prompt-text">{display || "(empty prompt)"}</span>
      <span className="prompt-age">— {fmtAge(now - latest.ts)} ago</span>
    </div>
  );
}
