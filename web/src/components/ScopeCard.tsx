import { useMemo, useState } from "react";
import type { SessionSnapshot } from "../types.js";
import { filterScope } from "../lib/scopeFilter.js";

interface Props { snapshot?: SessionSnapshot }

export function ScopeCard({ snapshot }: Props) {
  const [readsOpen, setReadsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => snapshot ? filterScope(snapshot.scope, query) : undefined,
    [snapshot, query],
  );
  if (!snapshot || !filtered) return null;

  const editedEntries = Object.entries(filtered.edited);
  const added = editedEntries.reduce((s, [, v]) => s + v.added, 0);
  const removed = editedEntries.reduce((s, [, v]) => s + v.removed, 0);
  const unreviewed = editedEntries.filter(([, v]) => !v.reviewed).length
                   + filtered.created.length;
  const hasQuery = query.trim().length > 0;

  return (
    <section className="scope" aria-label="Session scope">
      <div className="panel-title">
        Scope of this session
        {unreviewed > 0 && !hasQuery &&
          <span style={{ color: "var(--warn)" }}> · {unreviewed} unreviewed</span>}
      </div>

      <div className="scope-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search a path…"
          aria-label="search files in scope"
        />
        {hasQuery && (
          filtered.matched
            ? <span className="match-count">{filtered.totalHits} match{filtered.totalHits === 1 ? "" : "es"}</span>
            : <span className="match-count none">not touched this session</span>
        )}
      </div>

      {!hasQuery && (
        <div className="scope-head">
          <b>{editedEntries.length} files edited</b>{" "}
          <span style={{ color: "var(--ok)" }}>(+{added} −{removed})</span>,{" "}
          <b>{filtered.created.length} created</b>,{" "}
          <b>{filtered.deleted.length} deleted</b>,{" "}
          <b>{filtered.read.length} files read for context</b>.
        </div>
      )}

      <ul className="scope-list">
        {editedEntries.map(([path, v]) => (
          <EditedRow key={path} path={path} entry={v} />
        ))}
        {filtered.created.map((path) => (
          <li key={path} className="item">
            <span className="icon-n" aria-hidden="true">✨</span>
            <span className="path">{path}</span>
            <span className="badge new">new</span>
          </li>
        ))}
        {filtered.deleted.map((path) => (
          <li key={path} className="item">
            <span className="icon-d" aria-hidden="true">🗑</span>
            <span className="path">{path}</span>
          </li>
        ))}
        {!hasQuery && (
          <li className="item collapsed">
            <button
              className="reads-toggle"
              aria-expanded={readsOpen}
              onClick={() => setReadsOpen((v) => !v)}
            >
              {readsOpen ? "▾" : "▸"} {filtered.read.length} reads
            </button>
          </li>
        )}
        {(hasQuery || readsOpen) && filtered.read.map((path) => (
          <li key={path} className="item">
            <span className="icon-r" aria-hidden="true">📖</span>
            <span className="path">{path}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EditedRow({ path, entry }: { path: string; entry: import("../types.js").EditedFileEntry }) {
  const [open, setOpen] = useState(false);
  const canExpand = !!entry.lastDiff;
  return (
    <>
      <li className="item">
        <span className="icon-e" aria-hidden="true">✏️</span>
        <span className="path">{path}</span>
        <span className="delta">+{entry.added} −{entry.removed}</span>
        <span className={`badge ${entry.reviewed ? "reviewed" : "unreviewed"}`}>
          {entry.reviewed ? "reviewed" : "unreviewed"}
        </span>
        {canExpand && (
          <button className="exp-toggle" aria-expanded={open}
                  onClick={() => setOpen((v) => !v)}>{open ? "▾" : "▸"}</button>
        )}
      </li>
      {open && entry.lastDiff && <DiffPreview oldStr={entry.lastDiff.oldStr} newStr={entry.lastDiff.newStr} />}
    </>
  );
}

function DiffPreview({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  // Simple line-pair render. Not a real LCS-aligned diff (the panel is for
  // "is the change reasonable" not "show every hunk") — `−` then `+` blocks
  // make the change unambiguous at a glance.
  const oldLines = oldStr === "" ? [] : oldStr.split("\n");
  const newLines = newStr === "" ? [] : newStr.split("\n");
  return (
    <li className="item diff-row">
      <pre className="diff-block" aria-label="latest edit preview">
        {oldLines.map((l, i) => <div key={`o${i}`} className="diff-old">− {l}</div>)}
        {newLines.map((l, i) => <div key={`n${i}`} className="diff-new">+ {l}</div>)}
      </pre>
    </li>
  );
}

