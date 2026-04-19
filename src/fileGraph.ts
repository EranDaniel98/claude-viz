// Derive a file activity graph from a session's hook event stream.
//
// Nodes are files Claude has touched this session. Edges are co-occurrence
// within a "turn" (the span between two UserPromptSubmit events) — when
// Claude looks at A and B in the same turn, they co-occur, which is a
// usefully *behavioral* signal of which files are related, distinct from
// any static import graph.
//
// This module is pure — feed it the event list, get back a graph. No I/O,
// no time, no state. The HTTP layer reads the latest snapshot and calls
// `buildFileGraph(snapshot.recentEvents)` on demand.

import type { NormalizedEvent } from "./types.js";
import { parseBashMutations } from "./bashScope.js";

export type FileOp = "read" | "edit" | "create" | "delete";

export interface FileNode {
  path: string;
  basename: string;
  ops: { reads: number; edits: number; creates: number; deletes: number };
  firstTouchedTs: number;
  lastTouchedTs: number;
  /** Latest op decides the node's color. delete > create > edit > read. */
  latestOp: FileOp;
  /** The agent that performed the latest op (undefined = main session). */
  latestAgentId?: string;
}

export interface FileEdge {
  a: string;
  b: string;
  /** How many turns saw both `a` and `b` touched. */
  weight: number;
  /** Op kind co-occurrence breakdown — useful for edge thickness/color. */
  kinds: { editEdit: number; editRead: number; readRead: number };
}

export interface FileGraph {
  nodes: FileNode[];
  edges: FileEdge[];
  turnCount: number;
  /** Total file-touching ops in the event window. Helps the UI know if
   *  the graph is "thin" (Claude just started) vs "saturated". */
  totalOps: number;
}

/** Edges with weight below this threshold are dropped — keeps the graph
 *  legible. A pair must co-occur in at least 2 turns OR include an Edit×Edit
 *  pair (which is a strong coupling signal even on a single turn). */
const MIN_EDGE_WEIGHT = 2;

interface Touch { path: string; op: FileOp; ts: number; agentId?: string }

export function buildFileGraph(events: NormalizedEvent[]): FileGraph {
  // 1. Walk events, splitting into turns at UserPromptSubmit boundaries.
  const turns: Touch[][] = [];
  let current: Touch[] = [];
  let totalOps = 0;
  for (const e of events) {
    if (e.kind === "UserPromptSubmit") {
      if (current.length > 0) turns.push(current);
      current = [];
      continue;
    }
    if (e.kind !== "PostToolUse") continue;
    const touches = touchesFromEvent(e);
    for (const t of touches) {
      current.push(t);
      totalOps++;
    }
  }
  if (current.length > 0) turns.push(current);

  // 2. Aggregate nodes across all turns.
  const nodeMap = new Map<string, FileNode>();
  for (const turn of turns) {
    for (const t of turn) updateNode(nodeMap, t);
  }

  // 3. Aggregate co-occurrence edges per turn (dedup paths within a turn first).
  const edgeMap = new Map<string, FileEdge>();
  for (const turn of turns) {
    const perPath = new Map<string, FileOp>();
    for (const t of turn) {
      // Highest-priority op per path within a turn (edit beats read).
      const prev = perPath.get(t.path);
      perPath.set(t.path, prev ? maxOp(prev, t.op) : t.op);
    }
    const paths = Array.from(perPath.entries());
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        addEdge(edgeMap, paths[i], paths[j]);
      }
    }
  }

  // 4. Filter edges by min-weight unless they include an edit-edit pair.
  const edges = Array.from(edgeMap.values())
    .filter((e) => e.weight >= MIN_EDGE_WEIGHT || e.kinds.editEdit > 0);

  return {
    nodes: Array.from(nodeMap.values()).sort((a, b) => b.lastTouchedTs - a.lastTouchedTs),
    edges,
    turnCount: turns.length,
    totalOps,
  };
}

/** Project a single PostToolUse event into zero-or-more (path, op) touches. */
function touchesFromEvent(e: NormalizedEvent): Touch[] {
  if (!e.toolName || e.toolResponse?.isError) return [];
  const input = (e.toolInput ?? {}) as Record<string, unknown>;
  const filePath = typeof input.file_path === "string" ? input.file_path : undefined;
  const out: Touch[] = [];
  const push = (path: string, op: FileOp) =>
    out.push({ path, op, ts: e.ts, agentId: e.agentId });

  switch (e.toolName) {
    case "Edit":
    case "NotebookEdit":
      if (filePath) push(filePath, "edit");
      break;
    case "Write":
      if (filePath) push(filePath, "create");
      break;
    case "Read":
    case "Grep":
      if (filePath) push(filePath, "read");
      break;
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : undefined;
      if (!cmd) break;
      const m = parseBashMutations(cmd);
      for (const p of m.created) push(p, "create");
      for (const p of m.edited) push(p, "edit");
      for (const p of m.deleted) push(p, "delete");
      break;
    }
  }
  return out;
}

function updateNode(map: Map<string, FileNode>, t: Touch): void {
  let n = map.get(t.path);
  if (!n) {
    n = {
      path: t.path,
      basename: basenameOf(t.path),
      ops: { reads: 0, edits: 0, creates: 0, deletes: 0 },
      firstTouchedTs: t.ts,
      lastTouchedTs: t.ts,
      latestOp: t.op,
      latestAgentId: t.agentId,
    };
    map.set(t.path, n);
  }
  switch (t.op) {
    case "read":   n.ops.reads++; break;
    case "edit":   n.ops.edits++; break;
    case "create": n.ops.creates++; break;
    case "delete": n.ops.deletes++; break;
  }
  if (t.ts >= n.lastTouchedTs) {
    n.lastTouchedTs = t.ts;
    n.latestOp = maxOp(n.latestOp, t.op);
    n.latestAgentId = t.agentId;
  }
}

function addEdge(
  map: Map<string, FileEdge>,
  a: [string, FileOp],
  b: [string, FileOp],
): void {
  // Canonical ordering so {a,b} == {b,a}.
  const [p1, op1, p2, op2] = a[0] < b[0]
    ? [a[0], a[1], b[0], b[1]]
    : [b[0], b[1], a[0], a[1]];
  const key = `${p1}\x00${p2}`;
  let e = map.get(key);
  if (!e) {
    e = { a: p1, b: p2, weight: 0, kinds: { editEdit: 0, editRead: 0, readRead: 0 } };
    map.set(key, e);
  }
  e.weight++;
  const isEdit1 = op1 === "edit" || op1 === "create";
  const isEdit2 = op2 === "edit" || op2 === "create";
  if (isEdit1 && isEdit2) e.kinds.editEdit++;
  else if (isEdit1 || isEdit2) e.kinds.editRead++;
  else e.kinds.readRead++;
}

const OP_PRIORITY: Record<FileOp, number> = { read: 1, edit: 2, create: 3, delete: 4 };
function maxOp(a: FileOp, b: FileOp): FileOp {
  return OP_PRIORITY[b] > OP_PRIORITY[a] ? b : a;
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}
