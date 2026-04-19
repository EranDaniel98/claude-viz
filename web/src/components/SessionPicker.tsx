import type { SessionSnapshot } from "../types.js";

interface Props {
  snapshots: Map<string, SessionSnapshot>;
  selectedSessionId?: string;
  onSelect: (sessionId: string) => void;
}

/** Dropdown picker for the active session. Hidden when only one is known —
 *  no point burning topbar real estate on a single-option select. */
export function SessionPicker({ snapshots, selectedSessionId, onSelect }: Props) {
  if (snapshots.size <= 1) return null;
  // Sort most-recently-active first so the dropdown's natural top is the
  // session a user is likeliest to want to switch to.
  const sorted = Array.from(snapshots.values()).sort((a, b) => b.lastEventAt - a.lastEventAt);
  return (
    <select
      className="session-picker"
      aria-label="Select session"
      value={selectedSessionId ?? ""}
      onChange={(e) => onSelect(e.target.value)}
    >
      {sorted.map((s) => (
        <option key={s.sessionId} value={s.sessionId}>
          {s.sessionId.slice(0, 6)} · {basenameOf(s.cwd)}
        </option>
      ))}
    </select>
  );
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}
