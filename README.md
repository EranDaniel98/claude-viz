# Claude Viz

A local web dashboard for Claude Code CLI sessions. Makes three things legible:

1. **Live status** — at any moment, is Claude *working*, *thinking*, *stuck in a loop*, *errored*, or *done*?
2. **Session scope** — exactly *what did Claude change*: file edits via `Edit`/`Write`, plus filesystem mutations via `Bash` (`rm`, `mv`, `cp`, `touch`, `mkdir`, `sed -i`, `>` / `>>` redirections) that no edit-hook captures.
3. **Subagent activity** — when several subagents run in parallel, the terminal interleaves their output into one stream; the dashboard splits them back out, attributes tool calls to the right agent, and shows what each is doing right now.

Bonus: context-window gauge with token-burn anomaly detection, multi-session picker, redaction badge for any secrets the hook script saw before they were scrubbed.

Runs entirely on `127.0.0.1`. URL token guards every API call. No telemetry, no cloud.

## Quick start

```bash
# Install hooks (writes to ~/.claude/settings.json by default)
npx claude-viz init

# Start the dashboard — opens http://127.0.0.1:<random-port>/?k=<token>
npx claude-viz start
```

Then open a **new terminal** and run `claude` as usual. Existing Claude sessions don't pick up newly-installed hooks until they're restarted.

To install at project scope instead of user scope:

```bash
npx claude-viz init --project .
```

To remove:

```bash
npx claude-viz uninstall          # removes user-scope hooks
npx claude-viz uninstall -p .     # removes project-scope hooks
```

## Hooks aren't firing — what now?

The dashboard topbar shows `📄 events.jsonl` when the hook output file is reachable, or `⏳ no events yet` if the file exists but is empty. Two common causes:

1. **You started `claude` *before* running `claude-viz init`.** Hooks are loaded once at session start. Restart `claude`.
2. **Settings file collision.** Open `~/.claude/settings.json` and confirm `hooks.PreToolUse[]` (and the other six event arrays) contains a matcher group whose command path ends in `claude-viz-hook.sh`. If something else removed it, re-run `init`.

You can override the events file location with `CLAUDE_VIZ_EVENTS_FILE=/some/path` when starting the dashboard *and* set the same variable for the `claude` process.

## Development

```bash
npm install
npm run build               # builds server (dist/) and web (web/dist/)
npm test                    # vitest run — server, state, line-diff, bash-scope, components
CLAUDE_VIZ_EVENTS_FILE=/tmp/events.jsonl node bin/claude-viz.js start
```

Two test environments live in one config: server-side tests run on Node, component tests opt into jsdom via `// @vitest-environment jsdom` at the top of the file.

## Architecture

- `src/server.ts` — HTTP + WebSocket on `127.0.0.1`, URL-token auth, Host/Origin DNS-rebind defense, periodic context-window refresh, periodic session GC.
- `src/state.ts` — per-session store: scope, subagent tree, recent events ring buffer (capped at 200), pending-tool-call FIFO bound, child→parent agent attribution.
- `src/bashScope.ts` — lexical Bash command parser for filesystem mutations. Never *executes*, only reads.
- `src/redact.ts` — secret regex layer (AWS keys, GitHub tokens, OpenAI keys, Slack tokens, Bearer headers, PEM blocks) applied to every event before it touches the store.
- `src/transcript.ts` — context-window reader. Privacy invariant: never retains message *content*, only `usage` fields.
- `web/` — Vite + React + TypeScript. Multi-session aware via `useLiveState`; once you pick a session in the topbar, the UI sticks to it.

Design notes are under `docs/superpowers/` if you want the *why* behind specific decisions.

## Status

MVP complete. Working on dashboard v2 (see `docs/superpowers/specs/2026-04-17-dashboard-v2.md`).
