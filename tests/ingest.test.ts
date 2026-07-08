import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, appendFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { tailJsonl } from "../src/ingest.js";

let tmpRoot = "";

beforeEach(() => {
  tmpRoot = join(
    tmpdir(),
    `claude-viz-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

describe("tailJsonl", () => {
  it("emits each existing line as an event on start", async () => {
    const file = join(tmpRoot, "t1.jsonl");
    writeFileSync(file, JSON.stringify({ a: 1 }) + "\n" + JSON.stringify({ a: 2 }) + "\n");

    const received: unknown[] = [];
    const tail = await tailJsonl(file, (evt) => received.push(evt));

    // wait one tick for initial read
    await new Promise((r) => setTimeout(r, 80));

    expect(received).toEqual([{ a: 1 }, { a: 2 }]);
    await tail.close();
  });

  it("emits newly appended lines", async () => {
    const file = join(tmpRoot, "t2.jsonl");
    writeFileSync(file, "");

    const received: unknown[] = [];
    const tail = await tailJsonl(file, (evt) => received.push(evt));
    await new Promise((r) => setTimeout(r, 50));

    appendFileSync(file, JSON.stringify({ b: 1 }) + "\n");
    await new Promise((r) => setTimeout(r, 150));

    expect(received).toEqual([{ b: 1 }]);
    await tail.close();
  });

  it("skips malformed JSON lines silently", async () => {
    const file = join(tmpRoot, "t3.jsonl");
    writeFileSync(file, "not json\n" + JSON.stringify({ ok: true }) + "\n");

    const received: unknown[] = [];
    const tail = await tailJsonl(file, (evt) => received.push(evt));
    await new Promise((r) => setTimeout(r, 80));

    expect(received).toEqual([{ ok: true }]);
    await tail.close();
  });
});
