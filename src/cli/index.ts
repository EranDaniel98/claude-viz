import { Command } from "commander";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
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
      ?? join(homedir(), ".claude-viz", "events.jsonl");

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
