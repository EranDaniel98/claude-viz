import type { Health } from "../useHealth.js";

interface Props { health?: Health; connected: boolean }

const STALE_THRESHOLD_MS = 60_000;

/** Small topbar pill that surfaces hook-pipeline health.
 *  - "no events yet" when WS is up but the events file has never produced a row.
 *  - "events stale Ns" when WS is up but the file hasn't been written for >60s.
 *  - Otherwise shows the events file path (truncated). Full path on hover. */
export function HealthIndicator({ health, connected }: Props) {
  if (!health) return null;
  const now = Date.now();
  const noEvents = connected && health.eventsSeenCount === 0;
  const staleMs = health.lastMtimeMs !== undefined ? now - health.lastMtimeMs : undefined;
  const stale = connected && staleMs !== undefined && staleMs > STALE_THRESHOLD_MS && health.eventsSeenCount > 0;

  if (noEvents) {
    return (
      <span className="health warn" title={`Hook output should land at: ${health.eventsFile}\nIf empty, your hook script may not be installed correctly.`}>
        ⏳ no events yet
      </span>
    );
  }
  if (stale) {
    return (
      <span className="health warn" title={`Last event ${Math.floor(staleMs! / 1000)}s ago — the file is not being written to`}>
        ⏳ events stale {Math.floor(staleMs! / 1000)}s
      </span>
    );
  }
  return (
    <span className="events-file" title={health.eventsFile}>
      📄 {basenameOf(health.eventsFile)}
    </span>
  );
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}
