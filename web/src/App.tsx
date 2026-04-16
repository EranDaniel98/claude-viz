import { useLiveState } from "./useLiveState.js";
import { LiveActivity } from "./components/LiveActivity.js";
import { SubagentObservatory } from "./components/SubagentObservatory.js";
import { ScopeCard } from "./components/ScopeCard.js";

export function App() {
  const { snapshot, connected, redactions } = useLiveState();

  return (
    <div className="root">
      <header className="topbar">
        <span className="proj">📁 {snapshot?.cwd ?? "waiting…"}</span>
        <span className="sess">{snapshot?.sessionId ? `sess ${snapshot.sessionId.slice(0, 4)}` : "—"}</span>
        <span className="spacer" />
        {redactions > 0 && <span className="redaction">🛡 {redactions} redactions</span>}
        <span className={`health ${connected ? "ok" : "bad"}`}>
          {connected ? "hooks healthy" : "no connection"}
        </span>
      </header>

      <div className="grid">
        <section className="panel"><LiveActivity snapshot={snapshot} /></section>
        <section className="panel panel-wide"><SubagentObservatory snapshot={snapshot} /></section>
      </div>

      <ScopeCard snapshot={snapshot} />
    </div>
  );
}
