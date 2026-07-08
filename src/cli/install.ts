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
  // Claude Code hooks run under /usr/bin/bash on every platform (Git Bash on
  // Windows), so always install the POSIX script. A .cmd variant exists for
  // any caller who wires it up manually but the installer doesn't use it.
  const hookSrc = join(pkgRoot, "scripts", "hooks", "claude-viz-hook.sh");

  const vizHome = join(homedir(), ".claude-viz");
  await mkdir(vizHome, { recursive: true });
  const hookDst = join(vizHome, "claude-viz-hook.sh");
  await copyFile(hookSrc, hookDst);
  // chmod is a no-op on Windows filesystems; swallow any error.
  try { await chmod(hookDst, 0o755); } catch { /* ignore */ }

  const settingsPath = opts.scope === "user"
    ? join(homedir(), ".claude", "settings.json")
    : join(opts.projectDir!, ".claude", "settings.json");

  await mkdir(dirname(settingsPath), { recursive: true });

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  }
  const existingHooks = (settings.hooks ?? {}) as Record<string, unknown>;
  // Bash strips unrecognized `\<x>` escapes from double-quoted strings, which
  // mangles Windows paths like `C:\Users\...`. Forward slashes are accepted
  // by Node fs APIs, Git Bash, WSL, and Claude Code alike.
  const cmd = hookDst.replace(/\\/g, "/");

  // Claude Code hook schema per-event: an array of matcher groups, each
  //   { "matcher": "<tool-pattern-or-empty>", "hooks": [{ "type": "command", "command": "<cmd>" }] }
  // We register a single matcher group (empty matcher = match all tools)
  // that runs our hook script. Pre-existing groups authored by other tools
  // are preserved; a prior claude-viz group is replaced.
  const events = [
    "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
    "SubagentStart", "SubagentStop", "Stop",
  ];
  const ourGroup = {
    matcher: "",
    hooks: [{ type: "command", command: cmd }],
  };
  const isOurs = (g: unknown): boolean => {
    if (!g || typeof g !== "object") return false;
    const hooks = (g as { hooks?: unknown }).hooks;
    if (!Array.isArray(hooks)) return false;
    return hooks.some((h) =>
      h && typeof h === "object" &&
      typeof (h as { command?: unknown }).command === "string" &&
      ((h as { command: string }).command).includes("claude-viz-hook"),
    );
  };

  const nextHooks: Record<string, unknown> = { ...existingHooks };
  for (const event of events) {
    const prev = existingHooks[event];
    const base = Array.isArray(prev) ? prev.filter((g) => !isOurs(g)) : [];
    nextHooks[event] = [...base, ourGroup];
  }
  settings.hooks = nextHooks;
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));

  const eventsFile = join(vizHome, "events.jsonl");
  return { settingsPath, hookScriptPath: hookDst, eventsFile };
}
