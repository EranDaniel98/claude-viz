import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "./types.js";

export interface LiveState {
  snapshots: Map<string, SessionSnapshot>;
  selectedSessionId?: string;
  selectSession: (sessionId: string) => void;
  connected: boolean;
  /** Currently-selected session's snapshot (or undefined). */
  snapshot?: SessionSnapshot;
  /** Total redactions across ALL sessions seen this dashboard session. */
  redactions: number;
}

interface IncomingEvent { type: "event"; event: { session_id?: string }; seq: number }
interface IncomingSnapshot { type: "snapshot"; snapshot: SessionSnapshot }
type IncomingMsg = IncomingEvent | IncomingSnapshot;

/** WS-driven state. Tracks every session the server reports and keeps the
 *  user's selection sticky once they pick — never auto-switches mid-stream
 *  just because another session pushed an event. */
export function useLiveState(): LiveState {
  const [snapshots, setSnapshots] = useState<Map<string, SessionSnapshot>>(new Map());
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [connected, setConnected] = useState(false);
  // Once true, never auto-pick — respect user's choice even if a new session
  // becomes more active.
  const userPickedRef = useRef(false);

  const selectSession = useCallback((id: string) => {
    userPickedRef.current = true;
    setSelectedSessionId(id);
  }, []);

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("k") ?? "";
    const ws = new WebSocket(`ws://${window.location.host}/?k=${k}`);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    const upsertSnapshot = (snap: SessionSnapshot) => {
      setSnapshots((prev) => {
        const next = new Map(prev);
        next.set(snap.sessionId, snap);
        return next;
      });
      setSelectedSessionId((cur) => {
        if (cur || userPickedRef.current) return cur;
        // First-ever snapshot: auto-pick it.
        return snap.sessionId;
      });
    };

    ws.onmessage = (e) => {
      let msg: IncomingMsg;
      try { msg = JSON.parse(e.data) as IncomingMsg; } catch { return; }

      if (msg.type === "snapshot") {
        upsertSnapshot(msg.snapshot);
        return;
      }
      if (msg.type === "event") {
        const sid = msg.event.session_id;
        if (!sid) return;
        // Fetch fresh snapshot for the session that produced this event.
        // We don't reduce deltas client-side — server is source of truth.
        fetch(`/api/session/${encodeURIComponent(sid)}?k=${k}`)
          .then((r) => r.ok ? r.json() : null)
          .then((snap) => { if (snap) upsertSnapshot(snap as SessionSnapshot); })
          .catch(() => {});
      }
    };

    return () => { ws.close(); };
  }, []);

  // Sum redactions across all observed sessions.
  let redactions = 0;
  for (const s of snapshots.values()) redactions += s.redactions;

  const snapshot = selectedSessionId ? snapshots.get(selectedSessionId) : undefined;
  return { snapshots, selectedSessionId, selectSession, connected, snapshot, redactions };
}
