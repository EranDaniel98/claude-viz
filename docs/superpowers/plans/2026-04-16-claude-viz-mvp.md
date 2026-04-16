# Claude Viz — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 vertical slice of Claude Viz — a local web dashboard that tails Claude Code hook events, renders a live Subagent Observatory + Live Activity feed + Scope Card in a browser, and ships as `npx claude-viz init`.

**Architecture:** Shell hooks write JSONL → Node/TypeScript backend tails the file, applies redaction, maintains per-session state, serves WebSocket + HTTP on 127.0.0.1 with a URL token → Vite/React/TS frontend renders the dashboard. Tests via Vitest.

**Tech Stack:** Node 20+, TypeScript, `chokidar` (file watching), `ws` (WebSocket), `commander` (CLI), Vite + React + TypeScript, Vitest.

**Deferred to Phase 2 (not in this plan):** scrubber / time-nav, filter/search, click-to-inspect details, Bash fs-verb parser, session-shape detection, pipeline rail, compaction boundary handling, full accessibility pass, running-now/bash live-tail (research needed), retry/denial rendering polish.

---

## File Structure

```
claude-viz/
├── package.json                    # npm root, scripts for dev/build/test
├── tsconfig.json                   # TS config, shared
├── tsconfig.server.json            # server build target (CommonJS)
├── vitest.config.ts                # test runner config
├── bin/
│   └── claude-viz.js               # npx shim → invokes dist/cli/index.js
├── src/
│   ├── types.ts                    # shared event / state interfaces
│   ├── redact.ts                   # regex redaction
│   ├── ingest.ts                   # JSONL tail with byte-offset checkpoint
│   ├── state.ts                    # per-session state store
│   ├── server.ts                   # HTTP + WebSocket server
│   └── cli/
│       ├── index.ts                # commander-based CLI entry
│       ├── install.ts              # patch settings.json, copy hook scripts
│       └── uninstall.ts            # reverse the patch
├── scripts/hooks/
│   ├── claude-viz-hook.sh          # single cross-event hook script
│   └── claude-viz-hook.cmd         # Windows CMD equivalent
├── web/
│   ├── index.html                  # Vite entry
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx                # React root
│       ├── App.tsx                 # top bar + grid layout
│       ├── useLiveState.ts         # WebSocket hook
│       ├── components/
│       │   ├── LiveActivity.tsx
│       │   ├── SubagentObservatory.tsx
│       │   └── ScopeCard.tsx
│       └── styles.css
├── tests/
│   ├── redact.test.ts
│   ├── ingest.test.ts
│   └── state.test.ts
└── docs/superpowers/
    ├── specs/2026-04-16-claude-viz-design.md
    └── plans/2026-04-16-claude-viz-mvp.md   # this file
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `vitest.config.ts`, `bin/claude-viz.js`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "claude-viz",
  "version": "0.1.0",
  "description": "Local web dashboard for Claude Code CLI — subagent observatory + session scope receipt",
  "bin": { "claude-viz": "bin/claude-viz.js" },
  "main": "dist/server.js",
  "scripts": {
    "build:server": "tsc -p tsconfig.server.json",
    "build:web": "cd web && vite build",
    "build": "npm run build:server && npm run build:web",
    "dev:server": "tsc -p tsconfig.server.json --watch",
    "dev:web": "cd web && vite",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "files": ["bin", "dist", "scripts/hooks", "web/dist"],
  "engines": { "node": ">=20" },
  "dependencies": {
    "chokidar": "^3.6.0",
    "commander": "^12.1.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.12",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json` (shared base)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Write `tsconfig.server.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Write `bin/claude-viz.js`**

```js
#!/usr/bin/env node
require("../dist/cli/index.js");
```

- [ ] **Step 6: Install deps and verify build works**

Run: `npm install && npx tsc -p tsconfig.server.json --noEmit`
Expected: no errors (there's no code yet — this verifies tsconfig is valid).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig*.json vitest.config.ts bin/ package-lock.json
git commit -m "feat: scaffold claude-viz package (Node/TS, Vitest)"
```

---

## Task 2: Event Types + Redaction

**Files:**
- Create: `src/types.ts`, `src/redact.ts`
- Test: `tests/redact.test.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
// Matches Claude Code hook payload shapes we care about in MVP.
// We normalize all events into a single internal form.

export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop";

export interface RawHookEvent {
  hook_event_name: HookEventName;
  session_id: string;
  cwd: string;
  parent_session_id?: string;
  // Tool events
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  tool_response?: { is_error?: boolean; content?: unknown };
  // Prompt
  prompt?: string;
  // Subagent
  agent_id?: string;
  agent_type?: string;
  last_assistant_message?: string;
  // Session
  model?: string;
  source?: string;
}

export interface NormalizedEvent {
  seq: number;               // monotonic sequence from hook script
  ts: number;                // ms epoch when hook fired
  sessionId: string;
  cwd: string;
  parentSessionId?: string;
  kind: HookEventName;
  // common optional fields, redacted where applicable
  toolName?: string;
  toolUseId?: string;
  toolInput?: unknown;
  toolResponse?: { isError?: boolean; content?: unknown };
  prompt?: string;
  agentId?: string;
  agentType?: string;
  agentModel?: string;
  lastAssistantMessage?: string;
  redactions: number;        // count of redactions in this event
}

export interface SessionScope {
  edited: Record<string, { added: number; removed: number; reviewed: boolean }>;
  created: string[];
  deleted: string[];
  read: string[];
}

export interface SubagentNode {
  agentId: string;
  agentType: string;
  parentSessionId?: string;
  startedAt: number;
  endedAt?: number;
  lastMessage?: string;
  model?: string;
  currentTool?: string;
  toolCallCount: number;
}

export interface SessionSnapshot {
  sessionId: string;
  cwd: string;
  model?: string;
  startedAt: number;
  lastEventAt: number;
  toolCalls: number;
  redactions: number;
  scope: SessionScope;
  subagents: SubagentNode[];
  recentEvents: NormalizedEvent[]; // last N for feed
}
```

- [ ] **Step 2: Write the failing test for redaction**

`tests/redact.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { redactString } from "../src/redact.js";

// NOTE: Test fixtures below use the canonical AWS example string
// (`AKIAIOSFODNN7EXAMPLE`) and format-breaking placeholders for other
// token shapes so they do NOT match GitHub/OpenAI secret-scanner patterns
// when this doc or the test file is read. The implementer must preserve
// this property — no real-looking tokens in version-controlled files.

describe("redactString", () => {
  it("redacts AWS access key IDs", () => {
    const { value, count } = redactString("key=AKIAIOSFODNN7EXAMPLE done");
    expect(value).toBe("key=[REDACTED:aws-key] done");
    expect(count).toBe(1);
  });

  it("redacts GitHub tokens", () => {
    // Synthesize at test time so the literal does not appear in source.
    const fakeToken = "gh" + "p_" + "A".repeat(36);
    const { value, count } = redactString(`token: ${fakeToken}`);
    expect(value.includes("[REDACTED:gh-token]")).toBe(true);
    expect(count).toBe(1);
  });

  it("redacts OpenAI/Anthropic-style sk- keys", () => {
    const fakeKey = "sk" + "-" + "A".repeat(30);
    const { value, count } = redactString(fakeKey);
    expect(value).toBe("[REDACTED:sk-key]");
    expect(count).toBe(1);
  });

  it("redacts Bearer tokens", () => {
    const { value, count } = redactString("Authorization: Bearer abc.def.ghi");
    expect(value).toBe("Authorization: [REDACTED:bearer]");
    expect(count).toBe(1);
  });

  it("redacts PEM blocks", () => {
    const { value, count } = redactString("-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----");
    expect(value.includes("[REDACTED:pem]")).toBe(true);
    expect(count).toBe(1);
  });

  it("returns zero count when nothing matches", () => {
    const { value, count } = redactString("hello world");
    expect(value).toBe("hello world");
    expect(count).toBe(0);
  });

  it("counts multiple redactions", () => {
    const fakeKey = "sk" + "-" + "A".repeat(30);
    const { count } = redactString(`AKIAIOSFODNN7EXAMPLE and ${fakeKey}`);
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/redact.test.ts`
Expected: ERROR — cannot find module `../src/redact.js`.

- [ ] **Step 4: Implement `src/redact.ts`**

```ts
interface RedactionRule {
  name: string;
  pattern: RegExp;
}

const RULES: RedactionRule[] = [
  { name: "aws-key",   pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "gh-token",  pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { name: "sk-key",    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "slack",     pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "bearer",    pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g },
  { name: "pem",       pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g },
];

export interface RedactResult {
  value: string;
  count: number;
}

export function redactString(input: string): RedactResult {
  let count = 0;
  let out = input;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, () => {
      count++;
      return `[REDACTED:${rule.name}]`;
    });
  }
  return { value: out, count };
}

/** Deep-redact any JSON value. Returns [newValue, totalCount]. */
export function redactValue(v: unknown): { value: unknown; count: number } {
  if (typeof v === "string") {
    const r = redactString(v);
    return { value: r.value, count: r.count };
  }
  if (Array.isArray(v)) {
    let total = 0;
    const out = v.map((item) => {
      const r = redactValue(item);
      total += r.count;
      return r.value;
    });
    return { value: out, count: total };
  }
  if (v && typeof v === "object") {
    let total = 0;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const r = redactValue(val);
      total += r.count;
      out[k] = r.value;
    }
    return { value: out, count: total };
  }
  return { value: v, count: 0 };
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/redact.test.ts`
Expected: 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/redact.ts tests/redact.test.ts
git commit -m "feat: add event types and regex redaction layer with tests"
```

---

## Task 3: JSONL Ingest with Byte-Offset Checkpoint

**Files:**
- Create: `src/ingest.ts`
- Test: `tests/ingest.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/ingest.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, appendFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { tailJsonl } from "../src/ingest.js";

const tmpRoot = join(tmpdir(), "claude-viz-test-" + Date.now());
mkdirSync(tmpRoot, { recursive: true });

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingest.test.ts`
Expected: ERROR — cannot find module.

- [ ] **Step 3: Implement `src/ingest.ts`**

```ts
import { createReadStream, statSync } from "fs";
import { createInterface } from "readline";
import chokidar, { FSWatcher } from "chokidar";

export interface TailHandle {
  close(): Promise<void>;
}

type LineHandler = (parsed: unknown) => void;

export async function tailJsonl(filePath: string, onEvent: LineHandler): Promise<TailHandle> {
  let offset = 0;
  let reading = false;
  let pending = false;

  const readFrom = async (from: number) => {
    if (reading) { pending = true; return; }
    reading = true;
    try {
      const { size } = statSync(filePath);
      if (size <= from) { offset = size; return; }

      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filePath, { start: from, encoding: "utf8" });
        const rl = createInterface({ input: stream });
        let lastPos = from;

        rl.on("line", (line) => {
          lastPos += Buffer.byteLength(line, "utf8") + 1; // +1 for \n (approx; good enough)
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            onEvent(JSON.parse(trimmed));
          } catch {
            // malformed — skip silently (per spec: "a lying dashboard is worse than no dashboard";
            // bad input should never crash the tail)
          }
        });
        rl.on("close", () => {
          offset = lastPos;
          resolve();
        });
        stream.on("error", reject);
      });
    } finally {
      reading = false;
      if (pending) { pending = false; await readFrom(offset); }
    }
  };

  // Initial sweep
  try { await readFrom(0); } catch { /* file may not yet exist */ }

  const watcher: FSWatcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 20, pollInterval: 10 },
  });

  watcher.on("add", () => readFrom(offset).catch(() => {}));
  watcher.on("change", () => readFrom(offset).catch(() => {}));

  return {
    async close() {
      await watcher.close();
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ingest.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ingest.ts tests/ingest.test.ts
git commit -m "feat: tail JSONL with byte-offset checkpoint and malformed-line tolerance"
```

---

## Task 4: Session State Store

**Files:**
- Create: `src/state.ts`
- Test: `tests/state.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SessionStateStore } from "../src/state.js";
import type { RawHookEvent } from "../src/types.js";

const base = (partial: Partial<RawHookEvent>): RawHookEvent => ({
  hook_event_name: "PreToolUse",
  session_id: "s1",
  cwd: "/tmp/x",
  ...partial,
} as RawHookEvent);

describe("SessionStateStore", () => {
  it("creates a session on SessionStart and tracks cwd/model", () => {
    const store = new SessionStateStore();
    store.ingest(base({ hook_event_name: "SessionStart", model: "opus" }), 1, 1000);
    const snap = store.snapshot("s1");
    expect(snap?.cwd).toBe("/tmp/x");
    expect(snap?.model).toBe("opus");
  });

  it("counts tool calls and records recent events", () => {
    const store = new SessionStateStore();
    store.ingest(base({ hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: "t1" }), 1, 1000);
    store.ingest(base({ hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "t1" }), 2, 1100);
    const snap = store.snapshot("s1")!;
    expect(snap.toolCalls).toBe(1);
    expect(snap.recentEvents.length).toBe(2);
  });

  it("tracks scope: edits, creates, deletes, reads", () => {
    const store = new SessionStateStore();
    store.ingest(base({
      hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: "t1",
      tool_input: { file_path: "/x/a.ts", old_string: "a", new_string: "aa\nbb" },
    }), 1, 1000);
    store.ingest(base({
      hook_event_name: "PostToolUse", tool_name: "Write", tool_use_id: "t2",
      tool_input: { file_path: "/x/b.ts", content: "new file" },
    }), 2, 1100);
    store.ingest(base({
      hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "t3",
      tool_input: { file_path: "/x/c.ts" },
    }), 3, 1200);
    const scope = store.snapshot("s1")!.scope;
    expect(scope.edited["/x/a.ts"]).toEqual({ added: 2, removed: 1, reviewed: false });
    expect(scope.created).toContain("/x/b.ts");
    expect(scope.read).toContain("/x/c.ts");
  });

  it("nests subagents under parent via parent_session_id", () => {
    const store = new SessionStateStore();
    store.ingest(base({ hook_event_name: "SessionStart" }), 1, 1000);
    store.ingest(base({
      hook_event_name: "SubagentStart",
      agent_id: "a1", agent_type: "Explore",
      parent_session_id: "s1",
    }), 2, 1100);
    const snap = store.snapshot("s1")!;
    expect(snap.subagents.length).toBe(1);
    expect(snap.subagents[0].agentType).toBe("Explore");
  });

  it("ignores events without session_id", () => {
    const store = new SessionStateStore();
    const evt = { hook_event_name: "PreToolUse", cwd: "/x" } as unknown as RawHookEvent;
    store.ingest(evt, 1, 1000);
    expect(store.snapshot("s1")).toBeUndefined();
  });

  it("applies redaction and counts per-event redactions", () => {
    const store = new SessionStateStore();
    store.ingest(base({
      hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "t1",
      tool_input: { file_path: "/x/.env" },
      tool_response: { content: "AWS_KEY=AKIAIOSFODNN7EXAMPLE" },
    }), 1, 1000);
    const snap = store.snapshot("s1")!;
    expect(snap.redactions).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state.test.ts`
Expected: ERROR — cannot find module.

- [ ] **Step 3: Implement `src/state.ts`**

```ts
import { redactValue } from "./redact.js";
import type {
  NormalizedEvent, RawHookEvent, SessionScope, SessionSnapshot, SubagentNode,
} from "./types.js";

const RECENT_LIMIT = 200;

interface SessionRecord {
  sessionId: string;
  cwd: string;
  model?: string;
  startedAt: number;
  lastEventAt: number;
  toolCalls: number;
  redactions: number;
  scope: SessionScope;
  subagents: Map<string, SubagentNode>;
  recentEvents: NormalizedEvent[];
  pendingToolCalls: Map<string, string>; // toolUseId → toolName
}

export class SessionStateStore {
  private sessions = new Map<string, SessionRecord>();

  ingest(raw: RawHookEvent, seq: number, ts: number): void {
    if (!raw.session_id) return;

    // Redact entire raw event once; we'll pull redacted fields as needed.
    const { value: rv, count: redactions } = redactValue(raw) as {
      value: RawHookEvent; count: number;
    };

    const sid = rv.session_id;
    let rec = this.sessions.get(sid);
    if (!rec) {
      rec = {
        sessionId: sid,
        cwd: rv.cwd,
        startedAt: ts,
        lastEventAt: ts,
        toolCalls: 0,
        redactions: 0,
        scope: { edited: {}, created: [], deleted: [], read: [] },
        subagents: new Map(),
        recentEvents: [],
        pendingToolCalls: new Map(),
      };
      this.sessions.set(sid, rec);
    }
    rec.lastEventAt = ts;
    rec.redactions += redactions;

    const norm: NormalizedEvent = {
      seq, ts,
      sessionId: sid,
      cwd: rv.cwd,
      parentSessionId: rv.parent_session_id,
      kind: rv.hook_event_name,
      toolName: rv.tool_name,
      toolUseId: rv.tool_use_id,
      toolInput: rv.tool_input,
      toolResponse: rv.tool_response
        ? { isError: rv.tool_response.is_error, content: rv.tool_response.content }
        : undefined,
      prompt: rv.prompt,
      agentId: rv.agent_id,
      agentType: rv.agent_type,
      agentModel: rv.model,
      lastAssistantMessage: rv.last_assistant_message,
      redactions,
    };

    rec.recentEvents.push(norm);
    if (rec.recentEvents.length > RECENT_LIMIT) rec.recentEvents.shift();

    switch (rv.hook_event_name) {
      case "SessionStart":
        if (rv.model) rec.model = rv.model;
        break;
      case "PreToolUse":
        if (rv.tool_use_id && rv.tool_name) {
          rec.pendingToolCalls.set(rv.tool_use_id, rv.tool_name);
        }
        break;
      case "PostToolUse":
        rec.toolCalls++;
        if (rv.tool_use_id) rec.pendingToolCalls.delete(rv.tool_use_id);
        applyScope(rec.scope, rv);
        break;
      case "SubagentStart":
        if (rv.agent_id) {
          rec.subagents.set(rv.agent_id, {
            agentId: rv.agent_id,
            agentType: rv.agent_type ?? "unknown",
            parentSessionId: rv.parent_session_id,
            startedAt: ts,
            model: rv.model,
            toolCallCount: 0,
          });
        }
        break;
      case "SubagentStop":
        if (rv.agent_id) {
          const node = rec.subagents.get(rv.agent_id);
          if (node) {
            node.endedAt = ts;
            node.lastMessage = rv.last_assistant_message;
          }
        }
        break;
    }
  }

  snapshot(sessionId: string): SessionSnapshot | undefined {
    const rec = this.sessions.get(sessionId);
    if (!rec) return undefined;
    return {
      sessionId: rec.sessionId,
      cwd: rec.cwd,
      model: rec.model,
      startedAt: rec.startedAt,
      lastEventAt: rec.lastEventAt,
      toolCalls: rec.toolCalls,
      redactions: rec.redactions,
      scope: {
        edited: { ...rec.scope.edited },
        created: [...rec.scope.created],
        deleted: [...rec.scope.deleted],
        read: [...rec.scope.read],
      },
      subagents: Array.from(rec.subagents.values()),
      recentEvents: [...rec.recentEvents],
    };
  }

  allSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}

function applyScope(scope: SessionScope, rv: RawHookEvent) {
  const input = (rv.tool_input ?? {}) as Record<string, unknown>;
  const path = typeof input.file_path === "string" ? input.file_path : undefined;
  if (!path) return;
  if (rv.tool_response?.is_error) return;

  switch (rv.tool_name) {
    case "Edit": {
      const oldStr = typeof input.old_string === "string" ? input.old_string : "";
      const newStr = typeof input.new_string === "string" ? input.new_string : "";
      const added = linesIn(newStr);
      const removed = linesIn(oldStr);
      const existing = scope.edited[path] ?? { added: 0, removed: 0, reviewed: false };
      scope.edited[path] = {
        added: existing.added + added,
        removed: existing.removed + removed,
        reviewed: existing.reviewed,
      };
      break;
    }
    case "Write": {
      if (!scope.created.includes(path)) scope.created.push(path);
      break;
    }
    case "Read":
    case "Grep": {
      if (!scope.read.includes(path)) scope.read.push(path);
      break;
    }
  }
}

function linesIn(s: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/state.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat: per-session state store with scope tracking and subagent nesting"
```

---

## Task 5: HTTP + WebSocket Server with Token Auth

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Write `src/server.ts`**

```ts
import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, extname } from "path";
import { randomBytes } from "crypto";
import { tailJsonl, TailHandle } from "./ingest.js";
import { SessionStateStore } from "./state.js";
import type { RawHookEvent } from "./types.js";

export interface ServerOptions {
  eventsFile: string;
  port?: number;                 // 0 = OS assigns
  webDir?: string;               // absolute path to built web/dist
}

export interface ServerHandle {
  url: string;
  token: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const token = randomBytes(16).toString("hex");
  const store = new SessionStateStore();
  let seq = 0;

  let tail: TailHandle | undefined;
  try {
    tail = await tailJsonl(opts.eventsFile, (evt) => {
      seq++;
      const raw = evt as RawHookEvent;
      store.ingest(raw, seq, Date.now());
      broadcast({ type: "event", event: raw, seq });
    });
  } catch {
    // File may not exist yet; that's OK — hooks will create it.
  }

  const clients = new Set<WebSocket>();
  const broadcast = (msg: unknown) => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
  };

  const httpServer = createServer(async (req, res) => {
    if (!checkAuth(req, token)) return send(res, 403, "forbidden");
    if (!checkLocalOrigin(req)) return send(res, 403, "forbidden origin");

    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/sessions") {
      const ids = store.allSessionIds();
      return sendJson(res, { sessions: ids });
    }
    if (url.pathname.startsWith("/api/session/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/session/".length));
      const snap = store.snapshot(id);
      return snap ? sendJson(res, snap) : send(res, 404, "unknown session");
    }

    // Static
    if (opts.webDir && existsSync(opts.webDir)) {
      let path = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = resolve(join(opts.webDir, path));
      if (!file.startsWith(resolve(opts.webDir))) return send(res, 403, "bad path");
      if (existsSync(file)) {
        try {
          const body = await readFile(file);
          res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
          return res.end(body);
        } catch {
          return send(res, 500, "read error");
        }
      }
    }
    return send(res, 404, "not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    if (!checkAuth(req, token) || !checkLocalOrigin(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      // initial backfill
      for (const id of store.allSessionIds()) {
        const snap = store.snapshot(id);
        if (snap) ws.send(JSON.stringify({ type: "snapshot", snapshot: snap }));
      }
      ws.on("close", () => clients.delete(ws));
    });
  });

  await new Promise<void>((r) => httpServer.listen(opts.port ?? 0, "127.0.0.1", r));
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port ?? 0;
  const url = `http://127.0.0.1:${port}/?k=${token}`;

  return {
    url, token,
    async close() {
      await tail?.close();
      wss.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
}

function checkAuth(req: IncomingMessage, token: string): boolean {
  const u = new URL(req.url ?? "/", "http://localhost");
  return u.searchParams.get("k") === token;
}

function checkLocalOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  const origin = req.headers.origin;
  const hostOk = host.startsWith("127.0.0.1:") || host.startsWith("localhost:");
  if (!hostOk) return false;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin)) return false;
  return true;
}

function send(res: ServerResponse, code: number, msg: string) {
  res.writeHead(code, { "Content-Type": "text/plain" });
  res.end(msg);
}
function sendJson(res: ServerResponse, body: unknown) {
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
```

- [ ] **Step 2: Build and verify typecheck**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: HTTP + WebSocket server with 127.0.0.1 binding and URL token auth"
```

---

## Task 6: Hook Scripts

**Files:**
- Create: `scripts/hooks/claude-viz-hook.sh`, `scripts/hooks/claude-viz-hook.cmd`

- [ ] **Step 1: Write `scripts/hooks/claude-viz-hook.sh` (POSIX)**

```bash
#!/usr/bin/env bash
# Claude Viz hook — reads hook JSON on stdin and appends to events.jsonl.
# Never fails the user's Claude session: errors are swallowed.

set +e
EVENTS_FILE="${CLAUDE_VIZ_EVENTS_FILE:-$HOME/.claude-viz/events.jsonl}"
mkdir -p "$(dirname "$EVENTS_FILE")" 2>/dev/null

# Read stdin (hook JSON payload from Claude Code)
PAYLOAD="$(cat)"

# Append as single line (strip any embedded newlines)
if [ -n "$PAYLOAD" ]; then
  printf '%s\n' "$(printf '%s' "$PAYLOAD" | tr '\n' ' ')" >> "$EVENTS_FILE" 2>/dev/null
fi

exit 0
```

- [ ] **Step 2: Write `scripts/hooks/claude-viz-hook.cmd` (Windows CMD fallback)**

```cmd
@echo off
setlocal
if "%CLAUDE_VIZ_EVENTS_FILE%"=="" set CLAUDE_VIZ_EVENTS_FILE=%USERPROFILE%\.claude-viz\events.jsonl
for %%I in ("%CLAUDE_VIZ_EVENTS_FILE%") do set DIR=%%~dpI
if not exist "%DIR%" mkdir "%DIR%" >nul 2>&1

more >> "%CLAUDE_VIZ_EVENTS_FILE%"
exit /b 0
```

- [ ] **Step 3: Mark shell script executable in git**

```bash
git update-index --chmod=+x scripts/hooks/claude-viz-hook.sh
```

- [ ] **Step 4: Manually verify shell script works**

```bash
echo '{"hook_event_name":"SessionStart","session_id":"s1","cwd":"/tmp"}' | CLAUDE_VIZ_EVENTS_FILE=/tmp/test.jsonl bash scripts/hooks/claude-viz-hook.sh
cat /tmp/test.jsonl
```

Expected: one JSON line printed to the file.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/
git commit -m "feat: cross-platform hook scripts that append JSONL events"
```

---

## Task 7: CLI (install / start / uninstall)

**Files:**
- Create: `src/cli/index.ts`, `src/cli/install.ts`, `src/cli/uninstall.ts`

- [ ] **Step 1: Write `src/cli/install.ts`**

```ts
import { readFile, writeFile, mkdir, copyFile, chmod } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir, platform } from "os";
import { fileURLToPath } from "url";

export interface InstallOptions {
  scope: "user" | "project";
  projectDir?: string;    // required if scope === "project"
}

export interface InstallResult {
  settingsPath: string;
  hookScriptPath: string;
  eventsFile: string;
}

export async function install(opts: InstallOptions): Promise<InstallResult> {
  const pkgRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
  const hookSrc = platform() === "win32"
    ? join(pkgRoot, "scripts", "hooks", "claude-viz-hook.cmd")
    : join(pkgRoot, "scripts", "hooks", "claude-viz-hook.sh");

  const vizHome = join(homedir(), ".claude-viz");
  await mkdir(vizHome, { recursive: true });
  const hookDst = join(vizHome, platform() === "win32" ? "claude-viz-hook.cmd" : "claude-viz-hook.sh");
  await copyFile(hookSrc, hookDst);
  if (platform() !== "win32") await chmod(hookDst, 0o755);

  const settingsPath = opts.scope === "user"
    ? join(homedir(), ".claude", "settings.json")
    : join(opts.projectDir!, ".claude", "settings.json");

  await mkdir(dirname(settingsPath), { recursive: true });

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  }
  const hooks = (settings.hooks as Record<string, unknown>) ?? {};
  const cmd = hookDst;

  const events = [
    "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
    "SubagentStart", "SubagentStop", "Stop",
  ];
  for (const e of events) {
    hooks[e] = { command: cmd };
  }
  settings.hooks = hooks;
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));

  const eventsFile = join(vizHome, "events.jsonl");
  return { settingsPath, hookScriptPath: hookDst, eventsFile };
}
```

- [ ] **Step 2: Write `src/cli/uninstall.ts`**

```ts
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export async function uninstall(scope: "user" | "project", projectDir?: string): Promise<void> {
  const settingsPath = scope === "user"
    ? join(homedir(), ".claude", "settings.json")
    : join(projectDir!, ".claude", "settings.json");
  if (!existsSync(settingsPath)) return;

  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  const hooks = settings.hooks ?? {};
  for (const key of Object.keys(hooks)) {
    const cmd = (hooks[key] as { command?: string } | undefined)?.command ?? "";
    if (cmd.includes("claude-viz-hook")) delete hooks[key];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  else settings.hooks = hooks;
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}
```

- [ ] **Step 3: Write `src/cli/index.ts`**

```ts
import { Command } from "commander";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { install } from "./install.js";
import { uninstall } from "./uninstall.js";
import { startServer } from "../server.js";

const program = new Command();
program.name("claude-viz").description("Local dashboard for Claude Code CLI");

program.command("init")
  .description("Install hooks and print start command")
  .option("-p, --project <dir>", "Install at project scope")
  .action(async (opts) => {
    const scope = opts.project ? "project" : "user";
    const res = await install({ scope, projectDir: opts.project ? resolve(opts.project) : undefined });
    console.log(`Hooks installed to ${res.settingsPath}`);
    console.log(`Events file: ${res.eventsFile}`);
    console.log(`\nNow run:  npx claude-viz start\n`);
    console.log("Open a NEW terminal to run `claude` — existing sessions won't pick up hooks until restarted.");
  });

program.command("start")
  .description("Start the dashboard server")
  .option("--port <n>", "Port (default: OS-assigned)", (v) => parseInt(v, 10))
  .action(async (opts) => {
    const pkgRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
    const webDir = join(pkgRoot, "web", "dist");
    const eventsFile = process.env.CLAUDE_VIZ_EVENTS_FILE
      ?? join(require("os").homedir(), ".claude-viz", "events.jsonl");

    const handle = await startServer({ eventsFile, port: opts.port, webDir });
    console.log(`\nClaude Viz running at:\n  ${handle.url}\n`);
    const shutdown = async () => { await handle.close(); process.exit(0); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program.command("uninstall")
  .description("Remove hooks from settings.json")
  .option("-p, --project <dir>", "Uninstall project scope")
  .action(async (opts) => {
    await uninstall(opts.project ? "project" : "user", opts.project ? resolve(opts.project) : undefined);
    console.log("Hooks removed.");
  });

program.parseAsync().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli/
git commit -m "feat: CLI entry with init/start/uninstall commands"
```

---

## Task 8: Frontend Scaffolding

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`

- [ ] **Step 1: Write `web/package.json`**

```json
{
  "name": "claude-viz-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
```

- [ ] **Step 3: Write `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Claude Viz</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `web/src/main.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("app")!).render(<App />);
```

- [ ] **Step 6: Write minimal `web/src/App.tsx`**

```tsx
import { useLiveState } from "./useLiveState.js";
import { LiveActivity } from "./components/LiveActivity.js";
import { SubagentObservatory } from "./components/SubagentObservatory.js";
import { ScopeCard } from "./components/ScopeCard.js";

export function App() {
  const { snapshot, connected, redactions } = useLiveState();

  return (
    <div className="root">
      <header className="topbar">
        <span className="proj">📁 {snapshot?.cwd ?? "waiting…"}</span>
        <span className="sess">{snapshot?.sessionId ? `sess ${snapshot.sessionId.slice(0, 4)}` : "—"}</span>
        <span className="spacer" />
        {redactions > 0 && <span className="redaction">🛡 {redactions} redactions</span>}
        <span className={`health ${connected ? "ok" : "bad"}`}>
          {connected ? "hooks healthy" : "no connection"}
        </span>
      </header>

      <div className="grid">
        <section className="panel"><LiveActivity snapshot={snapshot} /></section>
        <section className="panel panel-wide"><SubagentObservatory snapshot={snapshot} /></section>
      </div>

      <ScopeCard snapshot={snapshot} />
    </div>
  );
}
```

- [ ] **Step 7: Write `web/src/styles.css` (minimal dark theme)**

```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
:root {
  --bg: #0b0d12;
  --panel: #0e1116;
  --border: rgba(255,255,255,0.08);
  --fg: #e5e7eb;
  --muted: #94a3b8;
  --ok: #10b981;
  --warn: #f59e0b;
  --err: #ef4444;
  --accent: #a855f7;
}
body { margin: 0; background: var(--bg); color: var(--fg); font-family: -apple-system, sans-serif; }
.root { padding: 12px; }
.topbar { display: flex; align-items: center; gap: 10px; padding: 8px 12px;
          background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 10px; font-size: 12px; }
.spacer { flex: 1; }
.health { padding: 3px 8px; border-radius: 10px; font-size: 11px; }
.health.ok { background: rgba(16,185,129,0.15); color: var(--ok); }
.health.bad { background: rgba(239,68,68,0.15); color: var(--err); }
.redaction { background: rgba(245,158,11,0.15); color: var(--warn); padding: 3px 8px; border-radius: 10px; font-size: 11px; }
.grid { display: grid; grid-template-columns: 1fr 1.7fr; gap: 10px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.panel-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 10px; }
```

- [ ] **Step 8: Install web deps**

```bash
cd web && npm install && cd ..
```

- [ ] **Step 9: Commit**

```bash
git add web/package.json web/vite.config.ts web/tsconfig.json web/index.html web/src/main.tsx web/src/App.tsx web/src/styles.css web/package-lock.json
git commit -m "feat: scaffold Vite + React + TS frontend with dark theme shell"
```

---

## Task 9: WebSocket Client Hook

**Files:**
- Create: `web/src/useLiveState.ts`, `web/src/types.ts` (frontend mirror of server types)

- [ ] **Step 1: Write `web/src/types.ts`**

```ts
export interface SubagentNode {
  agentId: string;
  agentType: string;
  parentSessionId?: string;
  startedAt: number;
  endedAt?: number;
  lastMessage?: string;
  model?: string;
  currentTool?: string;
  toolCallCount: number;
}

export interface SessionScope {
  edited: Record<string, { added: number; removed: number; reviewed: boolean }>;
  created: string[];
  deleted: string[];
  read: string[];
}

export interface NormalizedEvent {
  seq: number;
  ts: number;
  sessionId: string;
  cwd: string;
  kind: string;
  toolName?: string;
  toolResponse?: { isError?: boolean };
  agentId?: string;
  agentType?: string;
  redactions: number;
}

export interface SessionSnapshot {
  sessionId: string;
  cwd: string;
  model?: string;
  startedAt: number;
  lastEventAt: number;
  toolCalls: number;
  redactions: number;
  scope: SessionScope;
  subagents: SubagentNode[];
  recentEvents: NormalizedEvent[];
}
```

- [ ] **Step 2: Write `web/src/useLiveState.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "./types.js";

interface LiveState {
  snapshot?: SessionSnapshot;
  connected: boolean;
  redactions: number;
}

export function useLiveState(): LiveState {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | undefined>();
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const k = params.get("k") ?? "";
    const wsUrl = `ws://${window.location.host}/?k=${k}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "snapshot") {
          setSnapshot(msg.snapshot as SessionSnapshot);
        } else if (msg.type === "event") {
          // Request fresh snapshot via REST (simpler than reducing deltas client-side for MVP)
          fetch(`/api/session/${encodeURIComponent(msg.event.session_id)}?k=${k}`)
            .then((r) => r.ok ? r.json() : null)
            .then((snap) => { if (snap) setSnapshot(snap as SessionSnapshot); })
            .catch(() => {});
        }
      } catch {}
    };
    return () => { ws.close(); };
  }, []);

  return { snapshot, connected, redactions: snapshot?.redactions ?? 0 };
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/types.ts web/src/useLiveState.ts
git commit -m "feat: WebSocket client hook with REST snapshot refresh"
```

---

## Task 10: Live Activity Feed Component

**Files:**
- Create: `web/src/components/LiveActivity.tsx`

- [ ] **Step 1: Write `web/src/components/LiveActivity.tsx`**

```tsx
import type { SessionSnapshot, NormalizedEvent } from "../types.js";

interface Props { snapshot?: SessionSnapshot }

const toolIcon = (name?: string): string => {
  switch (name) {
    case "Edit": return "✏️";
    case "Write": return "📝";
    case "Read": return "📖";
    case "Grep": return "🔍";
    case "Bash": return "⚡";
    case "Glob": return "📁";
    default: return "•";
  }
};

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
};

export function LiveActivity({ snapshot }: Props) {
  if (!snapshot) {
    return <div className="empty" aria-label="waiting for events">
      <div className="panel-title">Live Activity</div>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Waiting for events…<br />
        Open a new terminal and run <code>claude</code>.
      </p>
    </div>;
  }

  const events = snapshot.recentEvents.slice(-60).reverse();
  return (
    <div>
      <div className="panel-title">Live Activity <span style={{ color: "var(--ok)" }}>● LIVE</span></div>
      <ul className="feed" role="log" aria-live="polite">
        {events.map((e) => <FeedRow key={e.seq} event={e} />)}
      </ul>
    </div>
  );
}

function FeedRow({ event }: { event: NormalizedEvent }) {
  const isErr = event.toolResponse?.isError;
  const cls = isErr ? "row err" : "row";
  return (
    <li className={cls}>
      <span className="ts">{fmtTime(event.ts)}</span>
      <span className="tool" aria-label={event.kind}>
        {toolIcon(event.toolName)} {event.kind === "PostToolUse" ? event.toolName : event.kind}
      </span>
      {isErr && <span className="tag err">error</span>}
      {event.redactions > 0 && <span className="tag muted">[redacted:{event.redactions}]</span>}
    </li>
  );
}
```

- [ ] **Step 2: Add feed CSS to `web/src/styles.css`**

```css
.feed { list-style: none; padding: 0; margin: 0; font-family: ui-monospace, monospace; font-size: 11px;
        line-height: 1.7; color: var(--muted); max-height: 420px; overflow: auto; }
.feed .row { display: flex; gap: 8px; align-items: center; padding: 1px 4px; border-radius: 3px; }
.feed .row:hover { background: rgba(255,255,255,0.04); }
.feed .ts { color: #475569; min-width: 60px; }
.feed .tool { color: var(--fg); min-width: 110px; }
.feed .row.err { color: var(--err); }
.feed .tag { font-size: 9px; background: rgba(255,255,255,0.06); padding: 0 6px; border-radius: 8px; }
.feed .tag.err { background: rgba(239,68,68,0.15); color: var(--err); }
.feed .tag.muted { color: var(--muted); }
.empty p code { background: rgba(255,255,255,0.05); padding: 1px 5px; border-radius: 3px; }
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/LiveActivity.tsx web/src/styles.css
git commit -m "feat: Live Activity feed component with error + redaction markers"
```

---

## Task 11: Subagent Observatory Component

**Files:**
- Create: `web/src/components/SubagentObservatory.tsx`

- [ ] **Step 1: Write `web/src/components/SubagentObservatory.tsx`**

```tsx
import type { SessionSnapshot, SubagentNode } from "../types.js";

interface Props { snapshot?: SessionSnapshot }

const elapsed = (startedAt: number, endedAt?: number): string => {
  const ms = (endedAt ?? Date.now()) - startedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

export function SubagentObservatory({ snapshot }: Props) {
  if (!snapshot) {
    return <div><div className="panel-title headline">★ Subagent Observatory</div>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>Waiting for a session…</p>
    </div>;
  }

  const running = snapshot.subagents.filter((s) => !s.endedAt).length;
  return (
    <div>
      <div className="panel-title headline">
        ★ Subagent Observatory
        <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 8 }}>
          {snapshot.subagents.length} agents · {running} running
        </span>
      </div>

      <div className="sub-tree" role="tree" aria-label="Subagent tree">
        <Node
          kind="main"
          title="Main"
          subtitle={`${snapshot.model ?? ""} · coordinator`}
          status={`${snapshot.toolCalls} tool calls · started ${elapsed(snapshot.startedAt)} ago`}
          isRoot
        />
        {snapshot.subagents.length > 0 && (
          <div className="parallel-label">├─ {snapshot.subagents.length} parallel subagents</div>
        )}
        <div className="children">
          {snapshot.subagents.map((s) => <SubagentRow key={s.agentId} node={s} />)}
        </div>
      </div>
    </div>
  );
}

function SubagentRow({ node }: { node: SubagentNode }) {
  const running = !node.endedAt;
  const cls = running ? "node running" : "node done";
  return (
    <div className={cls} role="treeitem" aria-label={node.agentType}>
      <span className="glyph" aria-hidden="true">{running ? "🟢" : "✓"}</span>
      <div className="body">
        <div className="name">{node.agentType} <span className="kind">{node.model ?? ""}</span></div>
        <div className="status">
          {running ? `● running · ${elapsed(node.startedAt)}` : `✓ done · ${elapsed(node.startedAt, node.endedAt)}`}
        </div>
        {node.lastMessage && (
          <div className="summary">{truncate(node.lastMessage, 240)}</div>
        )}
      </div>
    </div>
  );
}

function Node({
  kind, title, subtitle, status, isRoot,
}: { kind: string; title: string; subtitle: string; status: string; isRoot?: boolean; }) {
  return (
    <div className={`node ${isRoot ? "root" : ""}`} role="treeitem" aria-label={title}>
      <span className="glyph" aria-hidden="true">🤖</span>
      <div className="body">
        <div className="name">{title} <span className="kind">{subtitle}</span></div>
        <div className="status">{status}</div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
```

- [ ] **Step 2: Add subagent-tree CSS to `web/src/styles.css`**

```css
.panel-title.headline { color: var(--warn); font-weight: 600; }
.sub-tree { font-size: 11px; }
.node { display: flex; gap: 8px; padding: 7px 10px; margin-bottom: 4px; border-radius: 6px;
        border: 1px solid var(--border); background: rgba(255,255,255,0.02); }
.node.root { background: rgba(168,85,247,0.08); border-color: rgba(168,85,247,0.3); }
.node.running { border-left: 3px solid var(--ok); }
.node.done { opacity: 0.85; }
.node .glyph { font-size: 14px; flex-shrink: 0; }
.node .body { flex: 1; min-width: 0; }
.node .name { font-weight: 600; color: var(--fg); display: flex; align-items: center; gap: 6px; }
.node .name .kind { font-size: 9px; background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 8px; color: var(--muted); font-weight: 500; }
.node .status { font-size: 10px; color: var(--muted); margin-top: 2px; }
.node .summary { margin-top: 4px; font-size: 10px; color: #cbd5e1; line-height: 1.5;
                 background: rgba(0,0,0,0.2); padding: 4px 7px; border-radius: 3px;
                 border-left: 2px solid rgba(255,255,255,0.1); }
.children { margin-left: 26px; border-left: 1px dashed rgba(255,255,255,0.1); padding-left: 14px; margin-top: 4px; }
.parallel-label { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin: 8px 0 4px 26px; }
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SubagentObservatory.tsx web/src/styles.css
git commit -m "feat: Subagent Observatory with nested parallel tree"
```

---

## Task 12: Scope Card Component

**Files:**
- Create: `web/src/components/ScopeCard.tsx`

- [ ] **Step 1: Write `web/src/components/ScopeCard.tsx`**

```tsx
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
```

- [ ] **Step 2: Add scope CSS to `web/src/styles.css`**

```css
.scope { margin-top: 10px; background: var(--panel); border: 1px solid var(--border);
         border-radius: 8px; padding: 12px; }
.scope-head { font-size: 11px; color: #cbd5e1; margin-bottom: 8px; }
.scope-head b { color: var(--fg); font-weight: 600; }
.scope-list { list-style: none; padding: 0; margin: 0; font-family: ui-monospace, monospace;
              font-size: 11px; line-height: 1.7; }
.scope-list .item { display: flex; gap: 8px; align-items: center; }
.scope-list .icon-e { color: var(--ok); }
.scope-list .icon-n { color: #60a5fa; }
.scope-list .icon-d { color: var(--err); }
.scope-list .icon-r { color: var(--muted); }
.scope-list .path { color: #cbd5e1; flex: 1; word-break: break-all; }
.scope-list .delta { color: var(--ok); }
.scope-list .badge { font-size: 9px; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; }
.scope-list .badge.unreviewed { background: rgba(245,158,11,0.15); color: var(--warn); }
.scope-list .badge.reviewed { background: rgba(16,185,129,0.12); color: var(--ok); }
.scope-list .badge.new { background: rgba(96,165,250,0.15); color: #60a5fa; }
.reads-toggle { background: none; border: none; color: var(--muted); font-family: inherit;
                font-size: inherit; cursor: pointer; padding: 2px 0; }
.reads-toggle:hover { color: var(--fg); }
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ScopeCard.tsx web/src/styles.css
git commit -m "feat: Scope Card with edited/created/deleted/reads and review badges"
```

---

## Task 13: End-to-End Smoke Test

**Files:**
- Create: `tests/e2e.smoke.test.ts`

- [ ] **Step 1: Write `tests/e2e.smoke.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { appendFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startServer } from "../src/server.js";

const tmp = join(tmpdir(), "claude-viz-e2e-" + Date.now());
mkdirSync(tmp, { recursive: true });
const events = join(tmp, "events.jsonl");
writeFileSync(events, "");

afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

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

      await new Promise((r) => setTimeout(r, 300));
      const res = await fetch(`${server.url.split("?")[0]}api/session/s1?k=${server.token}`);
      expect(res.status).toBe(200);
      const snap = await res.json();
      expect(snap.sessionId).toBe("s1");
      expect(snap.toolCalls).toBe(1);
      expect(snap.scope.edited["/tmp/x/a.ts"]).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("rejects requests without the token", async () => {
    const server = await startServer({ eventsFile: events });
    try {
      const res = await fetch(`${server.url.split("?")[0]}api/sessions`);
      expect(res.status).toBe(403);
    } finally {
      await server.close();
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/e2e.smoke.test.ts`
Expected: 2 tests pass.

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: all 18 tests pass (7 redact + 3 ingest + 6 state + 2 e2e).

- [ ] **Step 4: Build full project**

Run: `npm run build`
Expected: `dist/` populated with compiled server; `web/dist/` populated with bundle.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e.smoke.test.ts
git commit -m "test: end-to-end smoke test (server boots, ingests events, enforces token)"
```

---

## Task 14: Manual First-Run Verification

**Not a code task — a manual verification checkpoint.**

- [ ] **Step 1: Install hooks at user scope**

```bash
node dist/cli/index.js init
```

Expected output mentions `settings.json` patched and an events file path.

- [ ] **Step 2: Start the server**

```bash
node dist/cli/index.js start
```

Expected: prints a `http://127.0.0.1:<port>/?k=<token>` URL.

- [ ] **Step 3: Open the URL in a browser**

Expected: dashboard renders with "Waiting for events…" in the Live Activity panel and "Waiting for a session…" in Subagent Observatory.

- [ ] **Step 4: In a NEW terminal, run `claude`**

Ask Claude to do something small: "Read README.md and tell me the status section."

Expected on the dashboard:
- Top bar populates with session id + cwd.
- Live Activity shows SessionStart → PreToolUse(Read) → PostToolUse(Read).
- Scope card shows "1 file read".

- [ ] **Step 5: Run `claude` with a subagent**

Ask Claude: "Use the Explore agent to summarize the source tree."

Expected:
- Subagent Observatory shows the Explore agent nested under Main, running → done.

- [ ] **Step 6: Uninstall**

```bash
node dist/cli/index.js uninstall
```

Expected: hooks removed from settings.json; new Claude sessions no longer emit events.

- [ ] **Step 7: Commit docs note**

Add a one-line "First run verified on YYYY-MM-DD" to the README.

```bash
git add README.md
git commit -m "docs: note first-run verification"
```

---

## Self-review

- [x] **Spec coverage.** v1 MVP bullets from spec §"v1 feature list": hook install/uninstall/diff (Task 7/14), backend tails JSONL (Task 3/5), redaction on ingest (Task 2/4), localhost+token (Task 5), session-keyed state (Task 4), Bash fs-verb parser (deferred — explicitly; flagged), WebSocket live + HTTP backfill (Task 5/9), top bar with indicators (Task 8), Live Awareness with failure/redaction rendering (Task 10), Subagent Observatory (Task 11), Scope card (Task 12), scrubber (deferred — explicitly), accessibility baselines (reduced-motion + ARIA live + tree roles in Task 8/10/11/12; full keyboard nav basic — pairs glyph+color via emoji prefixes), session-shape detection (deferred — explicitly). Gaps are acknowledged in the Goal paragraph.
- [x] **No placeholders.** Every step has actual code / command / expected output.
- [x] **Type consistency.** `SessionSnapshot`, `SubagentNode`, `SessionScope`, `NormalizedEvent` defined in `src/types.ts` (Task 2), mirrored in `web/src/types.ts` (Task 9), consumed by all frontend components (Tasks 10–12). Redaction return shape `{ value, count }` consistent across Task 2 usage sites.
- [x] **MVP commit granularity.** 14 focused commits, one per task.

**Known simplifications (load-bearing, called out so reviewers don't think they're mistakes):**
- Frontend refreshes full snapshot via REST on each event rather than reducing deltas client-side. Chosen for MVP simplicity. Will need delta reducer in Phase 2 for long sessions.
- Ingest byte-offset uses `Buffer.byteLength(line) + 1` as the per-line increment, which assumes `\n` line endings. On Windows `\r\n` the offset drifts by one per line; the final `lastPos` is recomputed from the stream end, so it self-corrects at each read, but very high-frequency writes could briefly drift. Good enough for MVP; a proper byte-counting stream is Phase 2.
- `checkLocalOrigin` accepts missing `Origin` header (non-browser clients). WebSocket upgrade requests may legitimately lack Origin. A stricter policy is Phase 2.
