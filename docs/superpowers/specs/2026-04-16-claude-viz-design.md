# Claude Viz — Design Spec

**Date:** 2026-04-16
**Status:** Draft for review

## Goal

A local web dashboard that runs alongside a Claude Code CLI session and makes two things legible that text output currently makes hard:

1. **Parallel subagent activity** — when several subagents run concurrently, text output interleaves into an unreadable stream.
2. **Session scope** — at the end (and during) a session, *what did Claude actually change* — including mutations made via Bash that no `Edit`/`Write` hook captures.

## Non-goals (explicitly cut)

- Dependency / call graphs
- Auto-generated flowcharts
- Treemap / heat-bubble project maps (original "blast radius" concept — replaced by scope card; see Decisions)
- Cross-session analytics / comparisons (v2)
- Time-travel replay (v2; basic scrubber only in v1)
- VS Code extension, desktop app, TUI (form-factor decision)

## High-level architecture

Three components, all local:

```
┌──────────────────┐       ┌──────────────────┐       ┌────────────────┐
│ Claude Code hook │──────▶│ claude-viz       │──────▶│ Browser (local │
│ (shell script,   │ JSONL │ backend (Node):  │  WS   │  dashboard)    │
│ fires per event) │       │ · tails JSONL    │       │                │
│                  │       │ · parses txcript │       │                │
│ Claude Code      │       │ · redacts        │       └────────────────┘
│ transcript file  │──────▶│ · serves HTTP+WS │
│ (~/.claude/...)  │ poll  │   on 127.0.0.1   │
└──────────────────┘       └──────────────────┘
```

**Why this shape (alternatives considered):**

- Hooks vs. wrapping the CLI: hooks are lower coupling (survives CLI upgrades if payload shape is stable), can't break the user's `claude` invocation, already an intended extension point.
- Hooks vs. only transcript: hooks are lower-latency (sub-second), transcript gives richer data (token usage, full content) but lags on disk flush. Using both — hooks for live, transcript for backfill/enrichment.
- JSONL file vs. named pipe / socket: file is the simplest, survives hook script crashes, Windows-friendly (no named-pipe pain), and lets the backend restart without losing data.

## Components

### 1. Hook scripts

A small shell script per hook event. Reads JSON on stdin, writes a normalized record to `${VIZ_EVENTS_DIR}/events.jsonl`.

**Hooks subscribed (v1):**
- `PreToolUse` — start of a tool call
- `PostToolUse` — end of a tool call (result / error)
- `UserPromptSubmit` — new user turn
- `SubagentStart` / `SubagentStop` — subagent lifecycle
- `SessionStart` — model, resume source
- `Stop` — turn end
- `PreCompact` / `PostCompact` — compaction boundaries
- `Notification` — permission prompts, idle, etc.

**Script requirements:**
- Must never fail the user's Claude session. On any error (disk full, permission, bad JSON), silently `exit 0`.
- Must be pure-POSIX / Node-with-no-deps so it runs on macOS / Linux / WSL / Windows-Git-Bash without extra install.
- Must tag every event with a monotonic sequence number to detect dropped events server-side.

### 2. Backend (`claude-viz` Node process)

Responsibilities:
- Tail `events.jsonl` (crash-safe via byte-offset checkpoint).
- Poll `~/.claude/projects/<hash>/sessions/*.jsonl` transcripts for enrichment (token usage, `is_error`, full content).
- Apply **redaction layer** on ingest (see Security).
- Maintain in-memory per-session state keyed by `session_id`. *Known limitation: a backend restart loses live state; it will backfill from the transcript on reconnect but the scrubber timeline before the restart may be thin. SQLite persistence is a v2 upgrade.*
- Expose WebSocket for live updates + HTTP for backfill/replay.
- Bind to `127.0.0.1` only; require a random URL token (`?k=<128-bit>`) to defeat DNS rebinding.
- Emit **synthetic file-change events** by parsing `Bash` tool inputs for filesystem verbs (`rm`, `mv`, `cp`, `sed -i`, `>`, `>>`, `mkdir`, `rmdir`, `ln`, `touch`, `git checkout --`) — best-effort, tagged as `synthetic` in the feed.
- Detect **session shape** from the first N events (code / docs / ops / single-file / multi-repo). Shape affects layout hints sent to the frontend.

**Alternatives considered for state:**
- In-memory only vs. SQLite: in-memory for v1 (simpler, fine for single-session). SQLite moved to v2 when cross-session analytics land.
- Per-session vs. per-cwd state: per-session (keyed on `session_id`). cwd is insufficient for concurrent sessions or worktrees in the same repo.

### 3. Frontend (web dashboard)

Stack: vanilla or lightweight framework (Preact / Svelte). No build pipeline that requires users to run a bundler — backend serves pre-built assets.

Layout: see `content/v1.1-dashboard.html` mockup. Sections:

1. **Top bar** — project, session shape badge, session id, redaction counter, hook-health pill (with schema version).
2. **Live Awareness panel (left, ~35%)** — "Running now" header with Bash live-tail, pipeline rail (Plan → Search → Edit → Verify → Report, derived heuristically from tool-call pattern — clearly labeled "inferred" in tooltip to set expectations), filter/search bar, scrolling tool feed with failure / retry / denial / bash-fs / redaction markers, click-to-inspect rows, "last seen" divider.
3. **Subagent Observatory (right, ~65%) — HEADLINE** — nested tree of subagents. Root = main agent. Parallel branches rendered side by side. Each node: agent kind + model, current tool (if running), final summary (if done), elapsed time, nested sub-subagents expandable.
4. **Scope card (below grid)** — plain-text receipt: N edited (+x −y), N created, N deleted, N read. Each edited/created/deleted file listed with line deltas and reviewed/unreviewed/new/bash-synthetic badge. Reads collapsed by default.
5. **Scrubber strip (bottom)** — horizontal timeline with compaction marker(s), current position, session length, token counter.

## Key design decisions

### Scope card replaces "blast radius"

Original design used a heat-bubble map with folder clusters. Replaced because:
- Heat-by-touch-count conflates *activity* (reads) with *importance* (edits), so a 3-line surgical edit becomes invisible while 20 context reads glow hot.
- Top-level folder grouping breaks for monorepos (one giant bubble), flat `src/` layouts, and non-code workflows (personal notes, single-file edits).
- "Blast radius" metaphor carries damage/threat connotations — wrong affective frame for a trust tool.

The scope card is boring on purpose. The anxiety-reducer is *legibility*, not visualization.

### Subagent observatory is the headline

The differentiation analysis surfaced that most dashboard features lose to existing tools (`git status`, editor file tree, `statusline`, reading the output). The one feature with no good alternative: making parallel subagent work legible. v1 is built around this, other features support it.

### What was cut (and why)

| Cut | Reason |
|---|---|
| Narrative ticker | Redundant with pipeline rail + feed (same story, three abstraction levels) |
| Edit:read ratio sparkline | Vanity metric, no action triggered |
| Tool-calls/min sparkline | Same |
| Heat bubbles | See above |

### Time decay is rank-based, not time-based

For any "recency" signal (e.g., "recently touched"), always normalize to *current* rank, not absolute time. Guarantees contrast survives 4-hour sessions without a saturated mid-warm blob.

## Cross-cutting concerns

### Privacy & security

- **Redaction on ingest.** Regex pass for API key shapes (`AKIA…`, `ghp_…`, `sk-…`, `xoxb-…`), `Bearer …` tokens, JWT shape, `-----BEGIN …` blocks, and `.env` file reads. Redacted content replaced with `[REDACTED:kind]`. Redaction counter visible in top bar.
- **Localhost binding.** Bind to `127.0.0.1`, never `0.0.0.0`. Validate `Host` and `Origin` headers to defeat DNS rebinding. Random URL token required.
- **No browser persistence.** `Cache-Control: no-store`. No `localStorage`, no IndexedDB, no service workers. Event history in memory only, optional explicit export.
- **Hook config drift alert.** Backend hashes `settings.json` hooks on startup, warns on mid-session change.

### Accessibility

- Every color-encoded state pairs with a glyph and text label.
- Honor `prefers-reduced-motion`: pulses become instant state transitions; decay animations disabled in favor of numeric "age" text.
- Minimum contrast: AA (4.5:1) for body, AAA (7:1) target for primary text.
- Force-layout / tree views have parallel sorted list views with ARIA live regions.
- Keyboard navigation: all feed rows, subagent nodes, scope entries reachable and activatable without mouse.

### Session topology

- State keyed on `(session_id, cwd)` — never dedupe by repo inference.
- Session picker in top bar when multiple sessions are live on the same machine.
- Worktrees: distinct `cwd` → distinct session.
- Resume: on attach, backfill from transcript up to last-seen offset, then tail.
- Subagents: tracked via `parent_session_id` from `SubagentStart`, rendered nested under parent.
- Compaction: snapshot pre-compact state as an immutable chapter; fresh tail cursor after. "Since last compaction" toggle on counters.

### Session shape

First N events (~20) inform layout:
- **Code session** (default) — layout as designed.
- **Docs/content session** (most edits to `.md`/`.txt`, reads of same) — swap LOC metrics for word-count deltas; scope card prefers files-by-section.
- **Ops session** (bash-dominant, few edits) — demote scope card, promote command timeline + exit-code strip.
- **Single-file session** (1 file edited, rest reads) — focus mode: that file's edit history as the primary view.
- **Multi-repo session** (cwd changes across repos) — scope card groups by repo.

Manual override: shape is a heuristic. A dropdown in the top bar lets the user lock a different shape if detection is wrong.

### Data integrity

- Sequence numbers per event; backend logs gaps.
- Hook vs. transcript reconciliation on each `Stop`: surface "N events missing from hooks" if mismatch.
- Tool cards for `Bash` always carry an "opaque — inspect command" note; never show "files changed" summary that excludes bash-synthetic events.
- Failed / retried / denied tool calls rendered distinctly (red / strikethrough / gray).

## Install & onboarding

Single command: `npx claude-viz init`

Installer does:
1. Detects Claude Code settings scope (user / project / both); shows a picker, diffs existing hooks before writing. Never silently merges.
2. Writes hook scripts to `~/.claude-viz/hooks/` and patches selected `settings.json`.
3. Detects shell (Git Bash / PowerShell / bash / zsh) and prints the exact invocation that works there.
4. Starts backend bound to `127.0.0.1`, prints tokenized URL.
5. First-launch empty state on the dashboard says explicitly: *"Open a new terminal and run `claude` — existing sessions won't pick up hooks until restarted"*, with a connection indicator that flips green on the first event.

Uninstall: `npx claude-viz uninstall` reverses the patch. Backend writes a sentinel on shutdown so hooks no-op cleanly if the server is down.

## v1 feature list (MVP)

- [ ] Hook install / uninstall / diff
- [ ] Backend tails JSONL + polls transcript
- [ ] Redaction layer on ingest
- [ ] Localhost binding with URL token
- [ ] Session-keyed state (handle concurrent + worktree)
- [ ] Bash fs-verb parser for synthetic events
- [ ] WebSocket live updates + HTTP backfill
- [ ] Frontend: top bar with hook/redaction/shape indicators
- [ ] Frontend: Live Awareness panel with filter/search, failure/retry/denial/bash-synthetic rendering, click-to-inspect
- [ ] Frontend: Subagent Observatory with nested parallel tree
- [ ] Frontend: Scope card
- [ ] Frontend: Basic scrubber with compaction marker
- [ ] Accessibility baselines (reduced-motion, contrast, glyph+color pairing, keyboard nav, list-view parallel to tree)
- [ ] Session shape detection (code / docs / ops / single-file / multi-repo)
- [ ] Empty / loading / error states

## Explicitly deferred to v2

- Rewind replay (drag scrubber → rehydrate full state at any past moment)
- Cross-session analytics (SQLite-backed): co-edit clusters, session compare, trend lines
- A/B compare view for two sessions on the same task
- URL-shareable permalinks (hash-based state serialization)
- Annotations / user notes on the timeline
- In-place permission approve/reject (requires write-back channel to Claude Code; check availability)
- Inline "Stop & tell Claude…" redirect (same dependency)
- Per-tool mute / folder hide configuration UI
- PII detector beyond regex (model-based)

## Open questions

1. **Hook hot-reload.** Do running `claude` sessions pick up new hook entries, or only new sessions do? The onboarding copy depends on this.
2. **Session transcript path stability.** Is `~/.claude/projects/<hash>/sessions/*.jsonl` a supported contract, or an implementation detail subject to change? If the latter, build the transcript-reader behind an interface and be prepared to degrade gracefully.
3. **Write-back channel.** Does Claude Code expose any way for an external tool to push a message into an active session (for future "Stop & redirect" feature)?
4. **MCP tool grouping.** Worth a dedicated swimlane in v1, or can they share the main feed with `mcp__` prefix as the only disambiguator?

## Success criteria

User-facing:
- User can answer "what did Claude change this session" without running `git status`.
- User can follow what 3+ parallel subagents are doing without re-reading terminal text.
- User can glance at the dashboard during a silent Bash command and see it's running (not hung).
- Install to first useful event: ≤ 90 seconds on a fresh machine.

Non-user-facing:
- Redaction recall: ≥ 95% on a canned corpus of `.env` reads, tokens, keys.
- Event drop detection: backend flags ≥ 99% of injected dropped events.
- No crash across a 4-hour dogfood session.
