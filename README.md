# Claude Viz

A local web dashboard for Claude Code CLI sessions. Makes two things legible:

1. **Parallel subagent activity** — when several subagents run at once, terminal text interleaves into an unreadable stream.
2. **Session scope** — at any point, *what did Claude actually change* — including filesystem mutations via Bash (`rm`, `mv`, `sed -i`) that no `Edit`/`Write` hook captures.

Runs alongside your `claude` session. Opens in a browser on `127.0.0.1`.

## Status

Early development. Design spec in [`docs/superpowers/specs/2026-04-16-claude-viz-design.md`](docs/superpowers/specs/2026-04-16-claude-viz-design.md).

## Quick start

Not yet. See spec for v1 scope.
