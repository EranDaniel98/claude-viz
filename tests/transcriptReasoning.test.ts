import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readReasoningByToolUseId, compact } from "../src/transcriptReasoning.js";

function tmpTranscript(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "viz-rsn-"));
  const file = join(dir, "transcript.jsonl");
  writeFileSync(file, lines.map((o) => JSON.stringify(o)).join("\n") + "\n");
  return file;
}

describe("readReasoningByToolUseId", () => {
  it("returns {} for missing files", async () => {
    expect(await readReasoningByToolUseId("/nonexistent/path.jsonl")).toEqual({});
  });

  it("indexes text-before-tool_use by tool_use id", async () => {
    const file = tmpTranscript([{
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I'll check the auth middleware first." },
          { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/x" } },
        ],
      },
    }]);
    const out = await readReasoningByToolUseId(file);
    expect(out["toolu_1"]).toBe("I'll check the auth middleware first.");
    rmSync(file, { force: true });
  });

  it("attributes only the text between consecutive tool_use blocks", async () => {
    const file = tmpTranscript([{
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Step 1." },
          { type: "tool_use", id: "a", name: "Read", input: {} },
          { type: "text", text: "Now grep." },
          { type: "tool_use", id: "b", name: "Grep", input: {} },
        ],
      },
    }]);
    const out = await readReasoningByToolUseId(file);
    expect(out["a"]).toBe("Step 1.");
    expect(out["b"]).toBe("Now grep.");
    rmSync(file, { force: true });
  });

  it("ignores non-assistant lines and malformed JSON", async () => {
    const file = tmpTranscript([
      { type: "user", message: { content: "hi" } },
      { type: "system", anything: 1 },
    ]);
    expect(await readReasoningByToolUseId(file)).toEqual({});
    rmSync(file, { force: true });
  });

  it("compact() collapses whitespace and caps length", () => {
    const long = "word ".repeat(100);
    const out = compact(long);
    expect(out.length).toBeLessThanOrEqual(241);
    expect(out).toMatch(/…$/);
    expect(compact("  hello   world  ")).toBe("hello world");
  });
});
