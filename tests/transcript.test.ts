import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  extractUsageFromLine,
  readLatestUsage,
  readAllUsages,
  contextTokens,
  contextLimitFor,
  newTokensInTurn,
  detectBurn,
} from "../src/transcript.js";
import type { TranscriptUsage } from "../src/transcript.js";

const mkUsage = (over: Partial<TranscriptUsage>): TranscriptUsage => ({
  inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
  timestampMs: 0, ...over,
});

let tmp = "";
beforeEach(() => {
  tmp = join(tmpdir(), `claude-viz-tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("extractUsageFromLine", () => {
  it("returns null for non-assistant records", () => {
    expect(extractUsageFromLine('{"type":"user"}')).toBeNull();
    expect(extractUsageFromLine('{"type":"permission-mode"}')).toBeNull();
    expect(extractUsageFromLine("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(extractUsageFromLine("{not json")).toBeNull();
  });

  it("returns null for assistant records without usage", () => {
    const line = JSON.stringify({ type: "assistant", message: { model: "x" } });
    expect(extractUsageFromLine(line)).toBeNull();
  });

  it("extracts tokens + model + timestamp when present", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-04-18T10:00:00.000Z",
      message: {
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 1,
          cache_read_input_tokens: 200_000,
          cache_creation_input_tokens: 500,
          output_tokens: 42,
        },
      },
    });
    const u = extractUsageFromLine(line)!;
    expect(u.inputTokens).toBe(1);
    expect(u.cacheReadInputTokens).toBe(200_000);
    expect(u.cacheCreationInputTokens).toBe(500);
    expect(u.outputTokens).toBe(42);
    expect(u.model).toBe("claude-opus-4-7");
    expect(u.timestampMs).toBe(Date.parse("2026-04-18T10:00:00.000Z"));
  });

  it("treats missing token fields as zero", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 5 } },
    });
    const u = extractUsageFromLine(line)!;
    expect(u.inputTokens).toBe(5);
    expect(u.cacheReadInputTokens).toBe(0);
    expect(u.cacheCreationInputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
  });
});

describe("readLatestUsage", () => {
  it("returns null when file is missing", async () => {
    const u = await readLatestUsage(join(tmp, "nope.jsonl"));
    expect(u).toBeNull();
  });

  it("returns null when no assistant messages exist", async () => {
    const f = join(tmp, "tx.jsonl");
    writeFileSync(f, [
      JSON.stringify({ type: "user" }),
      JSON.stringify({ type: "permission-mode" }),
    ].join("\n"));
    expect(await readLatestUsage(f)).toBeNull();
  });

  it("returns the last assistant usage when multiple exist", async () => {
    const f = join(tmp, "tx.jsonl");
    writeFileSync(f, [
      JSON.stringify({ type: "user" }),
      JSON.stringify({ type: "assistant", timestamp: "2026-04-18T09:00:00.000Z",
                      message: { usage: { input_tokens: 1, cache_read_input_tokens: 10_000 } } }),
      JSON.stringify({ type: "user" }),
      JSON.stringify({ type: "assistant", timestamp: "2026-04-18T10:00:00.000Z",
                      message: { usage: { input_tokens: 2, cache_read_input_tokens: 50_000 } } }),
    ].join("\n"));
    const u = (await readLatestUsage(f))!;
    expect(u.cacheReadInputTokens).toBe(50_000);
    expect(u.timestampMs).toBe(Date.parse("2026-04-18T10:00:00.000Z"));
  });
});

describe("contextTokens", () => {
  it("sums input + cache_read + cache_creation", () => {
    const total = contextTokens({
      inputTokens: 100, cacheReadInputTokens: 200_000, cacheCreationInputTokens: 500,
      outputTokens: 0, timestampMs: 0,
    });
    expect(total).toBe(200_600);
  });
});

describe("readAllUsages", () => {
  it("returns every assistant usage in chronological order", async () => {
    const f = join(tmp, "tx.jsonl");
    writeFileSync(f, [
      JSON.stringify({ type: "user" }),
      JSON.stringify({ type: "assistant", timestamp: "2026-04-18T09:00:00.000Z",
                      message: { usage: { input_tokens: 10 } } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-04-18T09:01:00.000Z",
                      message: { usage: { input_tokens: 20 } } }),
    ].join("\n"));
    const all = await readAllUsages(f);
    expect(all).toHaveLength(2);
    expect(all[0].inputTokens).toBe(10);
    expect(all[1].inputTokens).toBe(20);
  });

  it("returns [] when the file is missing", async () => {
    expect(await readAllUsages(join(tmp, "nope.jsonl"))).toEqual([]);
  });
});

describe("newTokensInTurn", () => {
  it("sums input + output + cache_creation (excludes cache_read)", () => {
    const u = mkUsage({ inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 200_000, cacheCreationInputTokens: 10 });
    expect(newTokensInTurn(u)).toBe(160);
  });
});

describe("detectBurn", () => {
  it("returns null when there are too few prior turns", () => {
    const usages = [mkUsage({ inputTokens: 100 }), mkUsage({ inputTokens: 200 })];
    expect(detectBurn(usages)).toBeNull();
  });

  it("is NOT burning when current matches the prior median", () => {
    const usages = [
      mkUsage({ inputTokens: 100 }), mkUsage({ inputTokens: 100 }),
      mkUsage({ inputTokens: 100 }), mkUsage({ inputTokens: 100 }),
    ];
    const b = detectBurn(usages)!;
    expect(b.isBurning).toBe(false);
    expect(b.median).toBe(100);
  });

  it("IS burning when current is an order of magnitude above the prior median", () => {
    const usages = [
      mkUsage({ inputTokens: 100 }), mkUsage({ inputTokens: 100 }),
      mkUsage({ inputTokens: 110 }), mkUsage({ inputTokens: 10_000 }),
    ];
    const b = detectBurn(usages)!;
    expect(b.isBurning).toBe(true);
    expect(b.ratio).toBeGreaterThan(50);
  });
});

describe("contextLimitFor", () => {
  it("returns 1M for the [1m] variant", () => {
    expect(contextLimitFor("claude-opus-4-6[1m]")).toBe(1_000_000);
  });
  it("returns 200k for standard models", () => {
    expect(contextLimitFor("claude-sonnet-4-6")).toBe(200_000);
    expect(contextLimitFor("claude-haiku-4-5")).toBe(200_000);
  });
  it("falls back to 200k when model is missing", () => {
    expect(contextLimitFor(undefined)).toBe(200_000);
  });
});
