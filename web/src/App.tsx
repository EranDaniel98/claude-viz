import { useLiveState } from "./useLiveState.js";
import { useHealth } from "./useHealth.js";
import { useReasoning } from "./useReasoning.js";
import { SubagentObservatory } from "./components/SubagentObservatory.js";
import { ScopeCard } from "./components/ScopeCard.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { NowFrame } from "./components/NowFrame.js";
import { FeedDrawer } from "./components/FeedDrawer.js";
import { ContextGauge } from "./components/ContextGauge.js";
import { PromptStrip } from "./components/PromptStrip.js";
import { HealthIndicator } from "./components/HealthIndicator.js";
import { SessionsOverview } from "./components/SessionsOverview.js";

export function App() {
  const { snapshot, snapshots, selectedSessionId, selectSession, connected, redactions } = useLiveState();
  const health = useHealth();
  const reasoning = useReasoning(snapshot?.sessionId, health?.showReasoning ?? false);

  return (
    <div className="root">
      <header className="topbar">
        <StatusBadge snapshot={snapshot} />
        <span className="proj">📁 {snapshot?.cwd ?? "waiting…"}</span>
        {snapshot?.model && <span className="model">{snapshot.model}</span>}
        <span className="sess">{snapshot?.sessionId ? `sess ${snapshot.sessionId.slice(0, 4)}` : "—"}</span>
        <span className="spacer" />
        {redactions > 0 && <span className="redaction">🛡 {redactions} redactions</span>}
        <HealthIndicator health={health} connected={connected} />
        <span className={`health ${connected ? "ok" : "bad"}`}>
          {connected ? "ws ok" : "no ws"}
        </span>
      </header>

      <SessionsOverview snapshots={snapshots} selectedSessionId={selectedSessionId} onSelect={selectSession} />
      <PromptStrip snapshot={snapshot} />
      <NowFrame snapshot={snapshot} />
      <ContextGauge snapshot={snapshot} />

      <section className="panel"><SubagentObservatory snapshot={snapshot} /></section>

      <ScopeCard snapshot={snapshot} />

      <FeedDrawer snapshot={snapshot} reasoning={reasoning} />
    </div>
  );
}
