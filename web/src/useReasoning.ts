import { useEffect, useState } from "react";

export interface ReasoningMap { [toolUseId: string]: string }

const POLL_MS = 8_000;

/** Polls /api/session/:id/reasoning for the assistant text that preceded
 *  each tool_use. Returns {} when the endpoint is disabled (404) or no
 *  session is selected. Off by default — the server only enables this
 *  when started with --reasoning or CLAUDE_VIZ_SHOW_REASONING=1. */
export function useReasoning(sessionId: string | undefined, enabled: boolean): ReasoningMap {
  const [map, setMap] = useState<ReasoningMap>({});
  useEffect(() => {
    setMap({});
    if (!sessionId || !enabled) return;
    const k = new URLSearchParams(window.location.search).get("k") ?? "";
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/session/${encodeURIComponent(sessionId)}/reasoning?k=${k}`);
        if (r.status !== 200) return;
        const data = await r.json() as ReasoningMap;
        if (!cancelled) setMap(data);
      } catch { /* swallow — feature is best-effort */ }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId, enabled]);
  return map;
}
