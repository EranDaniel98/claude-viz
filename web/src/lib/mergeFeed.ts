import type { NormalizedEvent } from "../types.js";

export type ToolRow = {
  kind: "tool";
  seq: number;
  ts: number;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  toolName: string;
  toolUseId: string;
  toolInput?: unknown;
  toolResponse?: { isError?: boolean; content?: unknown };
  isError?: boolean;
  isPending: boolean;
  agentId?: string;
  redactions: number;
};

export type EventRow = { kind: "event"; event: NormalizedEvent };

export type PromptRow = { kind: "prompt"; seq: number; ts: number; text: string };

export type TurnEndRow = {
  kind: "turn_end";
  seq: number;
  ts: number;
  durationMs?: number;
  toolCount: number;
  editCount: number;
};

export type ExplorationRow = {
  kind: "exploration";
  seq: number;      // seq of the first tool in the run
  ts: number;       // ts of the first tool
  endedAt: number;  // ts of the last tool
  count: number;
  paths: string[];  // file_path/pattern of each tool, in order
};

export type FeedRow = ToolRow | EventRow | PromptRow | TurnEndRow | ExplorationRow;

const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const EXPLORATION_TOOLS = new Set(["Read", "Grep", "Glob"]);
const EXPLORATION_WINDOW_MS = 20_000;   // P2
const EXPLORATION_MIN_RUN   = 3;

export function mergeFeedEvents(events: NormalizedEvent[]): FeedRow[] {
  const rows: FeedRow[] = [];
  const toolIndex = new Map<string, number>(); // tool_use_id → index in rows

  for (const event of events) {
    const id = event.toolUseId;

    if (event.kind === "SessionStart") continue;

    if (event.kind === "UserPromptSubmit") {
      rows.push({
        kind: "prompt",
        seq: event.seq,
        ts: event.ts,
        text: (event.prompt ?? "").split("\n")[0],
      });
      continue;
    }

    if (event.kind === "Stop") {
      let toolCount = 0;
      let editCount = 0;
      let promptTs: number | undefined;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.kind === "prompt") { promptTs = r.ts; break; }
        if (r.kind === "tool") {
          toolCount++;
          if (EDIT_TOOLS.has(r.toolName)) editCount++;
        }
      }
      rows.push({
        kind: "turn_end",
        seq: event.seq,
        ts: event.ts,
        durationMs: promptTs !== undefined ? event.ts - promptTs : undefined,
        toolCount,
        editCount,
      });
      continue;
    }

    if (event.kind === "PreToolUse" && id && event.toolName) {
      toolIndex.set(id, rows.length);
      rows.push({
        kind: "tool",
        seq: event.seq,
        ts: event.ts,
        startedAt: event.ts,
        toolName: event.toolName,
        toolUseId: id,
        toolInput: event.toolInput,
        isPending: true,
        agentId: event.agentId,
        redactions: event.redactions,
      });
      continue;
    }

    if (event.kind === "PostToolUse" && id) {
      const idx = toolIndex.get(id);
      if (idx !== undefined) {
        const row = rows[idx] as ToolRow;
        row.endedAt = event.ts;
        row.durationMs = event.ts - row.startedAt;
        row.toolResponse = event.toolResponse;
        row.isError = event.toolResponse?.isError ?? false;
        row.isPending = false;
        row.redactions += event.redactions;
        continue;
      }
      // Post without preceding Pre — best-effort: synthesize a completed row.
      rows.push({
        kind: "tool",
        seq: event.seq,
        ts: event.ts,
        startedAt: event.ts,
        endedAt: event.ts,
        durationMs: 0,
        toolName: event.toolName ?? "?",
        toolUseId: id,
        toolInput: event.toolInput,
        toolResponse: event.toolResponse,
        isError: event.toolResponse?.isError ?? false,
        isPending: false,
        agentId: event.agentId,
        redactions: event.redactions,
      });
      continue;
    }

    rows.push({ kind: "event", event });
  }

  return collapseExplorationRuns(rows);
}

/** Replace 3+ consecutive non-error Read/Grep/Glob ToolRows whose gap is ≤20s with one ExplorationRow. */
function collapseExplorationRuns(rows: FeedRow[]): FeedRow[] {
  const out: FeedRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (!isExplorationCandidate(row)) {
      out.push(row);
      i++;
      continue;
    }
    // Look ahead for a run of exploration tools within the window
    let j = i + 1;
    while (j < rows.length) {
      const next = rows[j];
      if (!isExplorationCandidate(next)) break;
      const prev = rows[j - 1] as ToolRow;
      if (next.kind !== "tool") break;
      if (next.startedAt - prev.startedAt > EXPLORATION_WINDOW_MS) break;
      j++;
    }
    const runLength = j - i;
    if (runLength >= EXPLORATION_MIN_RUN) {
      const run = rows.slice(i, j) as ToolRow[];
      out.push({
        kind: "exploration",
        seq: run[0].seq,
        ts: run[0].startedAt,
        endedAt: run[run.length - 1].endedAt ?? run[run.length - 1].startedAt,
        count: runLength,
        paths: run.map(pathOf),
      });
    } else {
      for (let k = i; k < j; k++) out.push(rows[k]);
    }
    i = j;
  }
  return out;
}

function isExplorationCandidate(row: FeedRow): row is ToolRow {
  return row.kind === "tool"
    && EXPLORATION_TOOLS.has(row.toolName)
    && !row.isError
    && !row.isPending;
}

function pathOf(row: ToolRow): string {
  const i = (row.toolInput ?? {}) as Record<string, unknown>;
  if (typeof i.file_path === "string") return i.file_path;
  if (typeof i.pattern   === "string") return i.pattern;
  return row.toolName;
}
