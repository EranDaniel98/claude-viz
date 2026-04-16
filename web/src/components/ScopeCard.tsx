import { useState } from "react";
import type { SessionSnapshot } from "../types.js";

interface Props { snapshot?: SessionSnapshot }

export function ScopeCard({ snapshot }: Props) {
  const [readsOpen, setReadsOpen] = useState(false);
  if (!snapshot) return null;

  const editedEntries = Object.entries(snapshot.scope.edited);
  const added = editedEntries.reduce((s, [, v]) => s + v.added, 0);
  const removed = editedEntries.reduce((s, [, v]) => s + v.removed, 0);
  const unreviewed = editedEntries.filter(([, v]) => !v.reviewed).length
                   + snapshot.scope.created.length;

  return (
    <section className="scope" aria-label="Session scope">
      <div className="panel-title">
        Scope of this session
        {unreviewed > 0 && <span style={{ color: "var(--warn)" }}> · {unreviewed} unreviewed</span>}
      </div>
      <div className="scope-head">
        <b>{editedEntries.length} files edited</b>{" "}
        <span style={{ color: "var(--ok)" }}>(+{added} −{removed})</span>,{" "}
        <b>{snapshot.scope.created.length} created</b>,{" "}
        <b>{snapshot.scope.deleted.length} deleted</b>,{" "}
        <b>{snapshot.scope.read.length} files read for context</b>.
      </div>
      <ul className="scope-list">
        {editedEntries.map(([path, v]) => (
          <li key={path} className="item">
            <span className="icon-e" aria-hidden="true">✏️</span>
            <span className="path">{path}</span>
            <span className="delta">+{v.added} −{v.removed}</span>
            <span className={`badge ${v.reviewed ? "reviewed" : "unreviewed"}`}>
              {v.reviewed ? "reviewed" : "unreviewed"}
            </span>
          </li>
        ))}
        {snapshot.scope.created.map((path) => (
          <li key={path} className="item">
            <span className="icon-n" aria-hidden="true">✨</span>
            <span className="path">{path}</span>
            <span className="badge new">new</span>
          </li>
        ))}
        {snapshot.scope.deleted.map((path) => (
          <li key={path} className="item">
            <span className="icon-d" aria-hidden="true">🗑</span>
            <span className="path">{path}</span>
          </li>
        ))}
        <li className="item collapsed">
          <button
            className="reads-toggle"
            aria-expanded={readsOpen}
            onClick={() => setReadsOpen((v) => !v)}
          >
            {readsOpen ? "▾" : "▸"} {snapshot.scope.read.length} reads
          </button>
        </li>
        {readsOpen && snapshot.scope.read.map((path) => (
          <li key={path} className="item">
            <span className="icon-r" aria-hidden="true">📖</span>
            <span className="path">{path}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
