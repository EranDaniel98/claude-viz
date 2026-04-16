import type { SessionSnapshot, NormalizedEvent } from "../types.js";

interface Props { snapshot?: SessionSnapshot }

const toolIcon = (name?: string): string => {
  switch (name) {
    case "Edit": return "✏️";
    case "Write": return "📝";
    case "Read": return "📖";
    case "Grep": return "🔍";
    case "Bash": return "⚡";
    case "Glob": return "📁";
    default: return "•";
  }
};

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
};

export function LiveActivity({ snapshot }: Props) {
  if (!snapshot) {
    return <div className="empty" aria-label="waiting for events">
      <div className="panel-title">Live Activity</div>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Waiting for events…<br />
        Open a new terminal and run <code>claude</code>.
      </p>
    </div>;
  }

  const events = snapshot.recentEvents.slice(-60).reverse();
  return (
    <div>
      <div className="panel-title">Live Activity <span style={{ color: "var(--ok)" }}>● LIVE</span></div>
      <ul className="feed" role="log" aria-live="polite">
        {events.map((e) => <FeedRow key={e.seq} event={e} />)}
      </ul>
    </div>
  );
}

function FeedRow({ event }: { event: NormalizedEvent }) {
  const isErr = event.toolResponse?.isError;
  const cls = isErr ? "row err" : "row";
  return (
    <li className={cls}>
      <span className="ts">{fmtTime(event.ts)}</span>
      <span className="tool" aria-label={event.kind}>
        {toolIcon(event.toolName)} {event.kind === "PostToolUse" ? event.toolName : event.kind}
      </span>
      {isErr && <span className="tag err">error</span>}
      {event.redactions > 0 && <span className="tag muted">[redacted:{event.redactions}]</span>}
    </li>
  );
}
