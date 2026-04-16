import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/** Detect a matcher group whose hooks reference the claude-viz script. */
function isOurs(group: unknown): boolean {
  if (!group || typeof group !== "object") return false;
  const hooks = (group as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) =>
    h && typeof h === "object" &&
    typeof (h as { command?: unknown }).command === "string" &&
    ((h as { command: string }).command).includes("claude-viz-hook"),
  );
}

export async function uninstall(scope: "user" | "project", projectDir?: string): Promise<void> {
  const settingsPath = scope === "user"
    ? join(homedir(), ".claude", "settings.json")
    : join(projectDir!, ".claude", "settings.json");
  if (!existsSync(settingsPath)) return;

  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;

  for (const key of Object.keys(hooks)) {
    const value = hooks[key];
    if (Array.isArray(value)) {
      // Correct schema: filter out our matcher groups.
      const kept = value.filter((g) => !isOurs(g));
      if (kept.length === 0) delete hooks[key];
      else hooks[key] = kept;
    } else if (value && typeof value === "object") {
      // Legacy/malformed shape written by an earlier buggy install.
      // Remove it if it references our script; leave otherwise.
      const cmd = (value as { command?: unknown }).command;
      if (typeof cmd === "string" && cmd.includes("claude-viz-hook")) {
        delete hooks[key];
      }
    }
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  else settings.hooks = hooks;
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}
