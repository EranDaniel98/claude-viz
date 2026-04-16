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
