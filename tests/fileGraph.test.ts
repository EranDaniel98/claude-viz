import { describe, it, expect } from "vitest";
import { buildFileGraph } from "../src/fileGraph.js";
import type { NormalizedEvent } from "../src/types.js";

let seq = 0;
const ev = (over: Partial<NormalizedEvent>): NormalizedEvent => ({
  seq: ++seq, ts: 1_000 + seq, sessionId: "s", cwd: "/x",
  kind: "PostToolUse", redactions: 0, ...over,
});

describe("buildFileGraph", () => {
  it("returns empty graph for no events", () => {
    seq = 0;
    expect(buildFileGraph([])).toEqual({ nodes: [], edges: [], turnCount: 0, totalOps: 0 });
  });

  it("creates one node per touched file with op counts", () => {
    seq = 0;
    const events = [
      ev({ kind: "UserPromptSubmit", prompt: "x" }),
      ev({ toolName: "Read",  toolInput: { file_path: "/p/a.ts" } }),
      ev({ toolName: "Read",  toolInput: { file_path: "/p/a.ts" } }),
      ev({ toolName: "Edit",  toolInput: { file_path: "/p/b.ts", old_string: "x", new_string: "y" } }),
      ev({ toolName: "Write", toolInput: { file_path: "/p/c.ts" } }),
    ];
    const g = buildFileGraph(events);
    expect(g.nodes.map((n) => n.path).sort()).toEqual(["/p/a.ts", "/p/b.ts", "/p/c.ts"]);
    const a = g.nodes.find((n) => n.path === "/p/a.ts")!;
    expect(a.ops.reads).toBe(2);
    expect(a.latestOp).toBe("read");
    expect(g.nodes.find((n) => n.path === "/p/b.ts")!.latestOp).toBe("edit");
    expect(g.nodes.find((n) => n.path === "/p/c.ts")!.latestOp).toBe("create");
  });

  it("emits Bash-mutation touches via parseBashMutations", () => {
    seq = 0;
    const events = [
      ev({ kind: "UserPromptSubmit", prompt: "x" }),
      ev({ toolName: "Bash", toolInput: { command: "mkdir build && rm -rf old.log" } }),
    ];
    const g = buildFileGraph(events);
    const paths = g.nodes.map((n) => n.path).sort();
    expect(paths).toEqual(["build", "old.log"]);
    expect(g.nodes.find((n) => n.path === "build")!.latestOp).toBe("create");
    expect(g.nodes.find((n) => n.path === "old.log")!.latestOp).toBe("delete");
  });

  it("co-occurrence edges within a turn (multi-touch threshold)", () => {
    seq = 0;
    // Two turns, both touching the same A+B pair → weight=2, passes MIN_EDGE_WEIGHT.
    const events = [
      ev({ kind: "UserPromptSubmit", prompt: "turn 1" }),
      ev({ toolName: "Read", toolInput: { file_path: "/p/a.ts" } }),
      ev({ toolName: "Read", toolInput: { file_path: "/p/b.ts" } }),
      ev({ kind: "UserPromptSubmit", prompt: "turn 2" }),
      ev({ toolName: "Read", toolInput: { file_path: "/p/a.ts" } }),
      ev({ toolName: "Read", toolInput: { file_path: "/p/b.ts" } }),
    ];
    const g = buildFileGraph(events);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({
      a: "/p/a.ts", b: "/p/b.ts", weight: 2,
      kinds: { editEdit: 0, editRead: 0, readRead: 2 },
    });
    expect(g.turnCount).toBe(2);
  });

  it("a single edit-edit pair survives the min-weight filter", () => {
    seq = 0;
    const events = [
      ev({ kind: "UserPromptSubmit", prompt: "x" }),
      ev({ toolName: "Edit", toolInput: { file_path: "/p/a.ts", old_string: "x", new_string: "y" } }),
      ev({ toolName: "Edit", toolInput: { file_path: "/p/b.ts", old_string: "x", new_string: "y" } }),
    ];
    const g = buildFileGraph(events);
    // weight=1 below threshold but editEdit > 0 → kept.
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].kinds.editEdit).toBe(1);
  });

  it("read-read pair touched only once is dropped (under threshold)", () => {
    seq = 0;
    const events = [
      ev({ kind: "UserPromptSubmit", prompt: "x" }),
      ev({ toolName: "Read", toolInput: { file_path: "/p/a.ts" } }),
      ev({ toolName: "Read", toolInput: { file_path: "/p/b.ts" } }),
    ];
    expect(buildFileGraph(events).edges).toHaveLength(0);
  });

  it("ignores errored tool calls", () => {
    seq = 0;
    const events = [
      ev({ kind: "UserPromptSubmit", prompt: "x" }),
      ev({ toolName: "Read", toolInput: { file_path: "/p/a.ts" }, toolResponse: { isError: true } }),
    ];
    expect(buildFileGraph(events).nodes).toEqual([]);
  });

  it("attributes the latest op to the agent that performed it", () => {
    seq = 0;
    const events = [
      ev({ kind: "UserPromptSubmit", prompt: "x" }),
      ev({ toolName: "Read", toolInput: { file_path: "/p/a.ts" } }),  // main
      ev({ toolName: "Read", toolInput: { file_path: "/p/a.ts" }, agentId: "agent-1" }),
    ];
    expect(buildFileGraph(events).nodes[0].latestAgentId).toBe("agent-1");
  });
});
