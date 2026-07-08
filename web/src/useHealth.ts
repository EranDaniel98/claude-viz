import { useEffect, useState } from "react";

export interface Health {
  eventsFile: string;
  fileExists: boolean;
  lastMtimeMs?: number;
  lastEventReceivedAt?: number;
  eventsSeenCount: number;
  sessionCount: number;
  showReasoning?: boolean;
}

const POLL_MS = 5_000;

/** Poll /api/health on a fixed interval. Returns undefined until first response.
 *  Errors are swallowed — the topbar already shows "no connection" via WS. */
export function useHealth(): Health | undefined {
  const [health, setHealth] = useState<Health | undefined>();
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("k") ?? "";
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/health?k=${k}`);
        if (!r.ok) return;
        const h = await r.json() as Health;
        if (!cancelled) setHealth(h);
      } catch { /* swallow */ }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return health;
}
