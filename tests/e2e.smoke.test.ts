import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startServer, type ServerHandle } from "../src/server.js";

let tmp = "";
let events = "";

beforeEach(() => {
  tmp = join(tmpdir(), `claude-viz-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  events = join(tmp, "events.jsonl");
  writeFileSync(events, "");
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const baseUrl = (server: ServerHandle): string => {
  // server.url is like http://127.0.0.1:PORT/?k=TOKEN
  const u = new URL(server.url);
  return `${u.protocol}//${u.host}`;
};

// Retries the snapshot fetch until the server has processed the event
// (file-watch latency varies across platforms — Windows is notably slower).
async function fetchSnapshotWithRetry(
  url: string,
  { timeoutMs = 3000, stepMs = 50 }: { timeoutMs?: number; stepMs?: number } = {},
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let last: Response | undefined;
  while (Date.now() < deadline) {
    last = await fetch(url);
    if (last.status === 200) return last;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return last!;
}

describe("server e2e", () => {
  it("serves snapshot after events arrive", async () => {
    const server = await startServer({ eventsFile: events });
    try {
      appendFileSync(events, JSON.stringify({
        hook_event_name: "SessionStart", session_id: "s1", cwd: "/tmp/x", model: "opus",
      }) + "\n");
      appendFileSync(events, JSON.stringify({
        hook_event_name: "PostToolUse", session_id: "s1", cwd: "/tmp/x",
        tool_name: "Edit", tool_use_id: "t1",
        tool_input: { file_path: "/tmp/x/a.ts", old_string: "x", new_string: "xx\nyy" },
      }) + "\n");

      const res = await fetchSnapshotWithRetry(
        `${baseUrl(server)}/api/session/s1?k=${server.token}`,
      );
      expect(res.status).toBe(200);
      const snap = await res.json();
      expect(snap.sessionId).toBe("s1");
      expect(snap.toolCalls).toBe(1);
      expect(snap.scope.edited["/tmp/x/a.ts"]).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("rejects API requests without the token", async () => {
    const server = await startServer({ eventsFile: events });
    try {
      const res = await fetch(`${baseUrl(server)}/api/sessions`);
      expect(res.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("serves static assets without the token (so bundle references resolve)", async () => {
    // Create a tiny webDir with an index.html the server can serve without auth.
    const webDir = join(tmp, "webdist");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(join(webDir, "index.html"), "<!doctype html><title>viz</title>");

    const server = await startServer({ eventsFile: events, webDir });
    try {
      const res = await fetch(`${baseUrl(server)}/index.html`); // no ?k=
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<title>viz</title>");
    } finally {
      await server.close();
    }
  });
});
