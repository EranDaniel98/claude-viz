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
