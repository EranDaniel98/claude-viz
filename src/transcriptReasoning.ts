// Reads assistant reasoning text that precedes each tool_use block in a
// session transcript, returning a {toolUseId → snippet} map.
//
// This breaks the "transcript reader never retains content" invariant that
// transcript.ts holds. Kept in a SEPARATE module on purpose so callers
// opt-in by importing this file specifically; the privacy-pure usage path
// (token counting) remains untouched.

import { readFile } from "fs/promises";

export interface ReasoningMap { [toolUseId: string]: string }

const MAX_SNIPPET = 240;

/** Walks a Claude Code transcript JSONL and returns the assistant text that
 *  immediately preceded each tool_use block, indexed by tool_use_id.
 *  Returns {} on read failure (no error propagated; this is best-effort). */
export async function readReasoningByToolUseId(filePath: string): Promise<ReasoningMap> {
  let raw: string;
  try { raw = await readFile(filePath, "utf8"); } catch { return {}; }
  const out: ReasoningMap = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    // Cheap pre-filter: skip lines that obviously can't carry tool_use blocks.
    if (line.indexOf('"tool_use"') === -1) continue;
    extractFromLine(line, out);
  }
  return out;
}

function extractFromLine(line: string, out: ReasoningMap): void {
  let rec: unknown;
  try { rec = JSON.parse(line); } catch { return; }
  if (!rec || typeof rec !== "object") return;
  const r = rec as Record<string, unknown>;
  if (r.type !== "assistant") return;

  const msg = r.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  if (!Array.isArray(content)) return;

  let buf = "";
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      buf += (buf ? " " : "") + b.text;
    } else if (b.type === "tool_use" && typeof b.id === "string") {
      // The reasoning for this tool_use is everything between it and the
      // previous tool_use (or message start). Reset for the next one.
      if (buf) out[b.id] = compact(buf);
      buf = "";
    }
  }
}

/** Collapse whitespace and cap to MAX_SNIPPET, breaking on a word boundary
 *  if possible. Returns the trimmed result. */
export function compact(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  if (trimmed.length <= MAX_SNIPPET) return trimmed;
  return trimmed.slice(0, MAX_SNIPPET).replace(/\s+\S*$/, "") + "…";
}
