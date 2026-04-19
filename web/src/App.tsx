import { useLiveState } from "./useLiveState.js";
import { SubagentObservatory } from "./components/SubagentObservatory.js";
import { ScopeCard } from "./components/ScopeCard.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { NowFrame } from "./components/NowFrame.js";
import { FeedDrawer } from "./components/FeedDrawer.js";
import { ContextGauge } from "./components/ContextGauge.js";

export function App() {
  const { snapshot, connected, redactions } = useLiveState();

  return (
    <div className="root">
      <header className="topbar">
        <StatusBadge snapshot={snapshot} />
        <span className="proj">📁 {snapshot?.cwd ?? "waiting…"}</span>
        {snapshot?.model && <span className="model">{snapshot.model}</span>}
        <span className="sess">{snapshot?.sessionId ? `sess ${snapshot.sessionId.slice(0, 4)}` : "—"}</span>
        <span className="spacer" />
        {redactions > 0 && <span className="redaction">🛡 {redactions} redactions</span>}
        <span className={`health ${connected ? "ok" : "bad"}`}>
          {connected ? "hooks healthy" : "no connection"}
        </span>
      </header>

      <NowFrame snapshot={snapshot} />
      <ContextGauge snapshot={snapshot} />

      <section className="panel"><SubagentObservatory snapshot={snapshot} /></section>

      <ScopeCard snapshot={snapshot} />

      <FeedDrawer snapshot={snapshot} />
    </div>
  );
}
