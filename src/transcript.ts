// Reads the latest assistant message's usage block from a session transcript.
// Privacy invariant: this module NEVER retains message content. It parses each
// line, extracts only the usage fields, and discards the line.

import { readFile } from "fs/promises";

export interface TranscriptUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  model?: string;          // per-message model, e.g. "claude-opus-4-7"
  timestampMs: number;     // from the transcript record's ISO timestamp
}

/** Total tokens currently in the context window. */
export function contextTokens(u: TranscriptUsage): number {
  return u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
}

/** Returns the latest usage in the file, or null if none found.
 *  Does NOT buffer, log, or return any message content. */
export async function readLatestUsage(filePath: string): Promise<TranscriptUsage | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  // Walk lines backward so we find the latest usage quickly.
  const lines = raw.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const u = extractUsageFromLine(lines[i]);
    if (u) return u;
  }
  return null;
}

/** Returns every assistant usage in the file, chronological order.
 *  Does NOT buffer, log, or return any message content beyond usage fields. */
export async function readAllUsages(filePath: string): Promise<TranscriptUsage[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const out: TranscriptUsage[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const u = extractUsageFromLine(line);
    if (u) out.push(u);
  }
  return out;
}

/** "New" tokens this turn introduced — the billable, non-cached portion. */
export function newTokensInTurn(u: TranscriptUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheCreationInputTokens;
}

export interface BurnAnalysis {
  currentNew: number;          // new tokens in the most recent turn
  median: number;              // median of prior turns
  mad: number;                 // median absolute deviation of prior turns
  ratio: number;               // currentNew / max(median, 1)
  isBurning: boolean;          // true when currentNew > 3× MAD above median AND ≥N priors
}

/** Detect a token-burn anomaly: newest turn's "new tokens" > median + 3*MAD. */
export function detectBurn(usages: TranscriptUsage[], minPrior = 3): BurnAnalysis | null {
  if (usages.length < minPrior + 1) return null;
  const current = usages[usages.length - 1];
  const priors = usages.slice(0, -1).map(newTokensInTurn).sort((a, b) => a - b);
  const median = priors[Math.floor(priors.length / 2)];
  const absDev = priors.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = absDev[Math.floor(absDev.length / 2)];
  const currentNew = newTokensInTurn(current);
  const threshold = median + 3 * (mad || Math.max(1, median * 0.1));
  return {
    currentNew, median, mad,
    ratio: currentNew / Math.max(median, 1),
    isBurning: currentNew > threshold,
  };
}

/** Extracts usage from a single JSONL line if it's an assistant-with-usage record.
 *  Returns null for any other kind of line. Never retains the line's content. */
export function extractUsageFromLine(line: string): TranscriptUsage | null {
  if (!line) return null;
  // Cheap pre-filter: avoid parsing lines that obviously can't carry usage.
  if (line.indexOf('"usage"') === -1) return null;

  let rec: unknown;
  try { rec = JSON.parse(line); } catch { return null; }
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Record<string, unknown>;
  if (r.type !== "assistant") return null;

  const msg = r.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== "object") return null;
  const usage = msg.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;

  const num = (k: string): number => {
    const v = usage[k];
    return typeof v === "number" ? v : 0;
  };
  const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;

  return {
    inputTokens: num("input_tokens"),
    outputTokens: num("output_tokens"),
    cacheReadInputTokens: num("cache_read_input_tokens"),
    cacheCreationInputTokens: num("cache_creation_input_tokens"),
    model: typeof msg.model === "string" ? msg.model : undefined,
    timestampMs: Number.isFinite(ts) ? ts : 0,
  };
}

/** Context-window limit for a given model descriptor. Conservative defaults. */
export function contextLimitFor(model: string | undefined): number {
  if (!model) return 200_000;
  // The [1m] suffix marks the 1M-context variant. Everything else defaults to 200k.
  if (/\[1m\]/i.test(model)) return 1_000_000;
  // Known exceptions could be added here as Claude Code publishes new models.
  return 200_000;
}
