import type { SessionSnapshot, SubagentNode } from "../types.js";

interface Props { snapshot?: SessionSnapshot }

const elapsed = (startedAt: number, endedAt?: number): string => {
  const ms = (endedAt ?? Date.now()) - startedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

export function SubagentObservatory({ snapshot }: Props) {
  if (!snapshot) {
    return <div><div className="panel-title headline">★ Subagent Observatory</div>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>Waiting for a session…</p>
    </div>;
  }

  const runningNodes = snapshot.subagents.filter((s) => !s.endedAt);
  const running = runningNodes.length;
  // "Hot" subagent: the one currently holding a tool call, breaking ties by cumulative tool count.
  // Only meaningful when 2+ are running; otherwise the badge is redundant.
  const hotId = running >= 2
    ? runningNodes
        .filter((s) => s.currentTool)
        .sort((a, b) => b.toolCallCount - a.toolCallCount)[0]?.agentId
    : undefined;

  return (
    <div>
      <div className="panel-title headline">
        ★ Subagent Observatory
        <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 8 }}>
          {snapshot.subagents.length} agents · {running} running
        </span>
      </div>

      <div className="sub-tree" role="tree" aria-label="Subagent tree">
        <Node
          kind="main"
          title="Main"
          subtitle={`${snapshot.model ?? ""} · coordinator`}
          status={`${snapshot.toolCalls} tool calls · started ${elapsed(snapshot.startedAt)} ago`}
          isRoot
        />
        {snapshot.subagents.length > 0 && (
          <div className="parallel-label">├─ {snapshot.subagents.length} parallel subagents</div>
        )}
        <div className="children">
          {snapshot.subagents.map((s) => (
            <SubagentRow key={s.agentId} node={s} hot={s.agentId === hotId} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SubagentRow({ node, hot }: { node: SubagentNode; hot: boolean }) {
  const running = !node.endedAt;
  const cls = `node ${running ? "running" : "done"}${hot ? " hot" : ""}`;
  const meta = [
    `${node.toolCallCount} tool use${node.toolCallCount === 1 ? "" : "s"}`,
    // Tokens come from the session transcript file, not hooks — Phase 2.
    "— tokens",
  ].join(" · ");

  return (
    <div className={cls} role="treeitem" aria-label={node.agentType}>
      <span className="glyph" aria-hidden="true">{hot ? "★" : running ? "🟢" : "✓"}</span>
      <div className="body">
        <div className="name">
          {node.agentType}
          <span className="kind">{node.model ?? ""}</span>
        </div>
        <div className="status">
          {running
            ? `● running · ${elapsed(node.startedAt)} · ${meta}`
            : `✓ done · ${elapsed(node.startedAt, node.endedAt)} · ${meta}`}
        </div>
        {node.brief && (
          <div className="brief" title={node.brief}>
            <span className="brief-glyph">›</span> {truncate(node.brief, 200)}
          </div>
        )}
        {running && node.currentTool && (
          <div className="current-tool" aria-label={`currently running ${node.currentTool}`}>
            <span className="arrow">↳</span> {node.currentTool}
          </div>
        )}
        {!running && node.lastMessage && (
          <div className="summary">{truncate(node.lastMessage, 240)}</div>
        )}
      </div>
    </div>
  );
}

function Node({
  kind, title, subtitle, status, isRoot,
}: { kind: string; title: string; subtitle: string; status: string; isRoot?: boolean; }) {
  return (
    <div className={`node ${isRoot ? "root" : ""}`} role="treeitem" aria-label={title}>
      <span className="glyph" aria-hidden="true">🤖</span>
      <div className="body">
        <div className="name">{title} <span className="kind">{subtitle}</span></div>
        <div className="status">{status}</div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
