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
