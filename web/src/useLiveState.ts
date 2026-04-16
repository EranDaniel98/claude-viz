import { useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "./types.js";

interface LiveState {
  snapshot?: SessionSnapshot;
  connected: boolean;
  redactions: number;
}

export function useLiveState(): LiveState {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | undefined>();
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const k = params.get("k") ?? "";
    const wsUrl = `ws://${window.location.host}/?k=${k}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "snapshot") {
          setSnapshot(msg.snapshot as SessionSnapshot);
        } else if (msg.type === "event") {
          // Request fresh snapshot via REST (simpler than reducing deltas client-side for MVP)
          fetch(`/api/session/${encodeURIComponent(msg.event.session_id)}?k=${k}`)
            .then((r) => r.ok ? r.json() : null)
            .then((snap) => { if (snap) setSnapshot(snap as SessionSnapshot); })
            .catch(() => {});
        }
      } catch {}
    };
    return () => { ws.close(); };
  }, []);

  return { snapshot, connected, redactions: snapshot?.redactions ?? 0 };
}
