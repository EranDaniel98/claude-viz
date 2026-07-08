# Claude Viz — Dashboard v2 Spec

**Date:** 2026-04-17 (updated 2026-04-18 with review decisions)
**Status:** Draft for review — research pass complete, no code yet.
**Supersedes scope of:** `2026-04-16-claude-viz-design.md` (v1 MVP). v1 still defines architecture, redaction, security, install. v2 is the UX+signal layer that turns the MVP from "events in a div" into a product.

## Why v2 exists

v1 answers "what events fired". That's the wrong level of abstraction. Five research agents independently converged on the same diagnosis: the dashboard is too close to the wire. A human returning to the dashboard after 10 minutes wants one word — `IDLE`, `WORKING`, `STUCK` — not 60 rows of `PreToolUse`/`PostToolUse` pairs.

v2 rebuilds around **three load-bearing signals**, demotes the feed to a drawer, and reads the session transcript JSONL to add real cost/context visibility.

---

## Review decisions (2026-04-18)

| Q | Decision |
|---|---|
| Transcript read in v2? | **Yes** — context-pressure gauge and token burn-rate are in scope. |
| `STUCK` heuristic? | **Agent 2's conservative version** — same `(tool, normalized input)` ≥3× with `is_error=true` in 60s. Single state, no sub-split. |
| Radical cut vs polish? | **Radical.** Status badge becomes the headline; the three v1 panels shrink; the feed becomes a collapsible drawer that auto-expands when the badge says something bad. |
| Stop-hook reliability? | **Verify empirically** before committing to the badge's `DONE` state. Pre-implementation task. |
| Thresholds? | **Calibrate first.** Run one real session, instrument, pick numbers from data — don't ship the guesses in this spec. |

---

## 1. The three load-bearing signals

### S1. Session status word — top-bar badge (the headline)

One word + one duration + optional chip, always visible. State machine over hook events:

| State | Meaning | Detection |
|---|---|---|
| `WORKING Xs` | tool in flight | `pendingToolCalls` non-empty |
| `THINKING Xs` | no open tool, active turn | last event was `UserPromptSubmit` or `PostToolUse`, within idle-threshold |
| `STUCK Xs` + `LOOP: <tool> <arg> ×N` chip | retry loop | same `(tool, normalized input)` hash with `is_error=true` ≥3× in 60s |
| `ERRORED Xs` | last tool failed, no recovery | most-recent `PostToolUse` has `is_error=true`, no newer success |
| `BLOCKED Xs` | awaiting permission | `PermissionRequest` hook if available, else inferred from long-pending `PreToolUse` |
| `IDLE Xs` | alive but quiet | no events for > idle-threshold, no pending tools |
| `DONE Xs` | turn ended cleanly | `Stop` hook fired; no newer activity |

**Precondition:** empirical check that `Stop` fires reliably across `/clear`, ctrl-C, crash, and natural end. If not, `DONE` collapses into `IDLE ≥ long-threshold`.

**Placement:** top-bar, far-left, in the largest typography on the page. Color + glyph + text (AA contrast, accessibility).

### S2. "Now" frame — sticky status line below the badge

One line: what's happening *right now*, with age and a useful detail.

- `● Bash: npm test — 47s`
- `● Thinking — 8s`
- `● Edit: src/auth/cookieStore.ts`
- `● Awaiting permission: Write src/x.ts`
- `⚠ Quiet 42s — last: Bash pytest (exited 0)`

**Data:** hooks only — `pendingToolCalls` + last-event age + current tool name + first-line of tool input.

### S3. Hot subagent highlight — inside the Observatory

When 2+ subagents run, promote the one with highest tool-calls-per-minute in the last 60s; dim the rest. Show its current tool on the highlighted node. Idle subagents collapse to `N idle`.

**Data:** per-subagent tool events already attributed via `childToAgent` + `SubagentNode.toolCallCount`.

---

## 2. Radical layout

```
┌──────────────────────────────────────────────────────────────────┐
│  WORKING 12s    [LOOP: Edit src/x.ts ×3]     sonnet-4.5 · sess… │ ← top bar, S1 dominant
├──────────────────────────────────────────────────────────────────┤
│  ● Bash: npm test — 47s                                          │ ← S2 "Now" frame
├──────────────────────────────────────────────────────────────────┤
│  Context 43% · 87k / 200k tokens                    ████▁▁▁▁▁▁▁ │ ← context gauge (transcript)
├──────────────────────────────────────────────────────────────────┤
│  Subagents (3)                                                   │
│    ★ explorer  [hot]  Grep "homedir"  8 calls/min               │ ← S3, compact when empty
│    · tester         Bash npm test     running 47s                │
│    · (1 idle)                                                    │
├──────────────────────────────────────────────────────────────────┤
│  Scope  [search…]      3 edited · 1 created · 12 read            │ ← one line + search
├──────────────────────────────────────────────────────────────────┤
│  ▸ Activity (67 events)                                          │ ← drawer, collapsed
└──────────────────────────────────────────────────────────────────┘
```

**Auto-expand rule:** the Activity drawer expands automatically when the badge enters `ERRORED` or `STUCK`, and on first `Edit`/`Write` after a fresh session. Otherwise collapsed.

**Why this is "right" per review (a.k.a. radical cut):** in normal operation, the badge + "Now" + subagent highlight answer every glance question. The feed is receipts, not the product. Users only open it when something's wrong — and it pops open on its own when that happens.

### 2.1 Drawer states

**State A — collapsed (default, happy path).** One line. Event count updates live; pulses on new event but doesn't expand.

```
─────────────────────────────────────────────────────────────────────
 ▸ Activity (67 events)                                    last +0.4s
─────────────────────────────────────────────────────────────────────
```

**State B — user-opened.** Click the chevron. Filter chips appear; feed scrolls from newest; relative-time gutter on the left; exploration runs collapsed; prompt divider anchors the turn. Based on the before/after from research agent 3 applied to a "debug why auth tests fail on Windows" session.

```
─────────────────────────────────────────────────────────────────────
 ▾ Activity (67 events)      [Edit] [Bash] [Read·] [Subagents] [Err]
─────────────────────────────────────────────────────────────────────
 ┌─ 14:02:11  "debug why auth tests fail on Windows" ──────────────┐
 │                                                                  │
 │  +7s   context: pwd, ls                                      (2) │
 │  +4s   🔎 explored 6 files · session.test.ts, session.ts,        │
 │                             cookieStore.ts, paths.ts, +2    ▸    │
 │  +16s  🤖 Task [explorer] map auth code paths on Windows         │
 │          └─ 3 tools · Read index.ts · Grep "homedir" · Read …    │
 │          └─ done 25s · "uses path.sep + homedir, ok"             │
 │  +0s   🤖 Task [tester]  run auth tests, capture failure         │
 │          └─ 1 tool  · Bash npm test -- auth                      │
 │          └─ done 17s · ⛔ 2 failures: cookie path mismatch       │
 │                                                                  │
 │  +23s  🔎 explored 2 files · cookieStore.ts, cookies.json   ▸    │
 │  +5s   ✏️ Edit src/auth/cookieStore.ts                     1.1s │
 │  +3s   ✏️ Edit src/auth/session.test.ts                    1.0s │
 │  +3s   ⚡ Bash npm test -- auth                            24s ✓│
 │  ──── turn end · 1m41s · 14 tools, 2 edits, 1 retry ────         │
 │                                                                  │
 └──────────────────────────────────────────────────────────────────┘
```

**State C — auto-expanded on `ERRORED` or `STUCK`.** Same feed, but pinned to the triggering row with a banner above it explaining why the drawer opened. Banner dismissable; auto-pins back if a new trigger fires.

```
─────────────────────────────────────────────────────────────────────
 ▾ Activity (67 events)  ⛔ auto-opened: STUCK on Edit src/x.ts
─────────────────────────────────────────────────────────────────────
 ┃ +0s   ✏️ Edit src/x.ts        failed (×3 in 47s) — same edit    ┃
 ┃ +12s  ✏️ Edit src/x.ts        failed                             ┃  ← triggering
 ┃ +18s  ✏️ Edit src/x.ts        failed                             ┃    row, pinned
 ┃                                                                   ┃
 │ ╔═══════════════════════════════════════════════════════════════╗ │
 │ ║ +0.4s  ⛔ Edit src/auth/cookieStore.ts   error                ║ │  ← banner row
 │ ║        TypeError: old_string not found in file                ║ │
 │ ╚═══════════════════════════════════════════════════════════════╝ │
 │  +8s   🔎 explored 1 file · cookieStore.ts                  ▸    │
 │  +2s   ✏️ Edit src/auth/cookieStore.ts                     1.1s ✓│
```

**Pulse rule (all three states).** On any new event in collapsed state, the drawer's chevron line pulses for ~600ms and the `(N events)` count increments. No auto-expand unless the trigger rules fire. `prefers-reduced-motion` replaces the pulse with a brief opacity bump.

### 2.2 Top-bar states (S1 badge)

The badge is the tallest element on the page. Glyph + word + age + optional chip. Color pairs with glyph for AA-contrast accessibility.

```
┌──────────────────────────────────────────────────────────────────┐
│  ● WORKING 12s                               sonnet-4.5 · sess…  │  blue   — tool in flight
│  ✴ THINKING 8s                               sonnet-4.5 · sess…  │  cyan   — model turn, no tool
│  ⛔ ERRORED 23s                               sonnet-4.5 · sess…  │  red    — last tool failed
│  ⚠ STUCK 47s   [LOOP: Edit src/x.ts ×3]      sonnet-4.5 · sess…  │  amber  — loop detected
│  ⏸ BLOCKED 14s  awaiting permission          sonnet-4.5 · sess…  │  amber  — permission prompt
│  ○ IDLE 3m                                   sonnet-4.5 · sess…  │  gray   — quiet, no Stop
│  ✓ DONE 1m                                   sonnet-4.5 · sess…  │  green  — Stop hook fired
└──────────────────────────────────────────────────────────────────┘
```

Redaction + hook-health pills live on the top-bar right, after the session chip (carried over from v1).

### 2.3 "Now" frame states (S2)

One line, updates in place. Prefix glyph indicates direction (active vs warning). Age in the same line keeps the answer in one eye-fix.

```
 ● Bash: npm test -- auth                                      47s
 ● Thinking                                                     8s
 ● Edit: src/auth/cookieStore.ts
 ● Read: src/auth/session.test.ts                           <100ms
 ⏸ Awaiting permission: Write src/secrets.env
 ⚠ Quiet 42s — last: Bash pytest (exited 0)
 ✓ Turn ended · 1m41s · 14 tools · 2 edits
```

When an active tool finishes and nothing follows within ~500ms, the frame transitions from `● Bash: npm test — 47s` → `✴ Thinking — 0s` (or → `⚠ Quiet Xs` after idle-threshold from P2).

### 2.4 Context-window gauge

Thin bar + numbers. Model limit comes from a static table (sonnet-4.5 → 200k, opus-4.7-1m → 1M, etc). Color thresholds from P2 calibration; placeholders here.

```
 Context 12% ·  24k / 200k tokens                  ██▁▁▁▁▁▁▁▁▁▁▁▁▁  green
 Context 43% ·  87k / 200k tokens                  ██████▁▁▁▁▁▁▁▁▁  green
 Context 78% · 156k / 200k tokens                  ████████████▁▁▁  amber
 Context 94% · 188k / 200k tokens                  ███████████████  red   compaction imminent
 Context 43%  🔥 burning 4× median — 18k this turn  ██████▁▁▁▁▁▁▁▁▁  burn anomaly
```

Burn-anomaly sub-state reuses the same row; if P2 shows it's too noisy, demote to a tooltip.

### 2.5 Subagent Observatory states (S3)

```
── Empty (no subs running) ──────────────────────────────────────
 Subagents — none running

── Single subagent ──────────────────────────────────────────────
 Subagents (1)
   ● code-reviewer   Grep "TODO"                 3 calls/min · 12s

── Multiple with hot highlight ──────────────────────────────────
 Subagents (3)
   ★ explorer    [hot]  Grep "homedir"           8 calls/min
   · tester             Bash npm test            running 47s
   · linter             Read .eslintrc                   idle 42s

── All idle (collapsed) ─────────────────────────────────────────
 Subagents (4)    all idle 1m+    ▸ expand

── After a subagent stops ───────────────────────────────────────
 Subagents (2 done, 0 running)
   ✓ explorer     25s · "uses path.sep + homedir, ok"
   ✓ tester       17s · ⛔ 2 failures: cookie path mismatch
```

Hot-highlight uses the star glyph plus a ring in the actual UI; idle rows are dimmed. Completed subagents linger at the bottom of the panel with their final message for the current turn, then clear on the next `UserPromptSubmit`.

### 2.6 Scope panel states

```
── Typical ──────────────────────────────────────────────────────
 Scope  [search…]            3 edited · 1 created · 12 read

── Search matched ───────────────────────────────────────────────
 Scope  [cookieStore____]    match: src/auth/cookieStore.ts
                             EDITED 2× · last 4m ago · +6 −2

── Search no-match ──────────────────────────────────────────────
 Scope  [payment_______]     not touched this session

── Expanded (click summary line) ────────────────────────────────
 Scope  [search…]            3 edited · 1 created · 12 read  ▾
   ✏️ src/auth/cookieStore.ts                       +6 −2   unreviewed
   ✏️ src/auth/session.test.ts                      +3 −1   unreviewed
   ✏️ src/auth/paths.ts                             +1 −0   unreviewed
   ✨ src/auth/_fixtures/cookies.json                         new
   ▸ 12 reads
```

Search is the primary affordance; the summary line is secondary; the full list is tertiary (one click away). Inverts v1's hierarchy.

### 2.7 Combined transition — STUCK fires, whole dashboard reacts

The point of the radical cut: one signal flips, the entire UI reshapes in one tick so the user doesn't have to scan for what changed.

**Before — happy path, drawer collapsed, nothing unusual.**

```
┌─────────────────────────────────────────────────────────────────┐
│  ● WORKING 4s                           sonnet-4.5 · sess-a1f9 │
├─────────────────────────────────────────────────────────────────┤
│  ● Edit: src/auth/cookieStore.ts                                │
├─────────────────────────────────────────────────────────────────┤
│  Context 43% · 87k / 200k                  ██████▁▁▁▁▁▁▁▁▁     │
├─────────────────────────────────────────────────────────────────┤
│  Subagents — none running                                       │
├─────────────────────────────────────────────────────────────────┤
│  Scope  [search…]             3 edited · 1 created · 12 read   │
├─────────────────────────────────────────────────────────────────┤
│  ▸ Activity (41 events)                               last +0.4s│
└─────────────────────────────────────────────────────────────────┘
```

**After — third identical failed Edit lands; STUCK trips.**

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠ STUCK 47s   [LOOP: Edit src/auth/cookieStore.ts ×3]  sess-a1│  ← S1 flips: word + color +
├─────────────────────────────────────────────────────────────────┤      LOOP chip appears
│  ⛔ Edit failed — same edit 3× in 47s (auto-opened feed below)  │  ← S2 becomes explanatory
├─────────────────────────────────────────────────────────────────┤
│  Context 44% · 88k / 200k                  ██████▁▁▁▁▁▁▁▁▁     │
├─────────────────────────────────────────────────────────────────┤
│  Subagents — none running                                       │
├─────────────────────────────────────────────────────────────────┤
│  Scope  [search…]             3 edited · 1 created · 12 read   │
├─────────────────────────────────────────────────────────────────┤
│  ▾ Activity (43 events)  ⛔ auto-opened: STUCK           [dism] │  ← drawer auto-expands,
│  ┃ +0s   ✏️ Edit src/auth/cookieStore.ts  failed (×3)         ┃│     pinned to trigger row,
│  ┃ +12s  ✏️ Edit src/auth/cookieStore.ts  failed               ┃│     banner names the reason
│  ┃ +22s  ✏️ Edit src/auth/cookieStore.ts  failed  ← newest     ┃│
│  │ ╔═══════════════════════════════════════════════════════╗   ││
│  │ ║ TypeError: old_string not found in file               ║   ││
│  │ ╚═══════════════════════════════════════════════════════╝   ││
└─────────────────────────────────────────────────────────────────┘
```

Four simultaneous changes, all from one backend event: badge flips + LOOP chip appears + "Now" frame becomes explanatory + drawer auto-opens pinned to the triggering rows. This is the moment v2 earns its keep over v1 — in v1 the user would have to scroll the 43-row feed to find the three identical Edit errors.

**Dismiss behavior.** `[dism]` collapses the drawer back but leaves the badge in STUCK. If a fresh STUCK/ERRORED trigger fires after dismiss, the drawer reopens with the new trigger. User has to fix or interrupt the session to clear the badge.

### 2.8 First-launch / empty state

```
┌──────────────────────────────────────────────────────────────────┐
│  ○ WAITING                                          no session   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Open a new terminal and run `claude`.                          │
│   Existing sessions won't pick up hooks until restarted.         │
│                                                                  │
│   Connection:  ● events file  ◌ no session yet                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Connection indicator flips green on first event received, then the full dashboard takes over.

---

## 3. What to remove from v1

1. **Paired Pre/Post rows** — merge by `tool_use_id` into one row with spinner-while-pending, duration + error tag on finish. Cuts ~50% of feed rows.
2. **`SessionStart` row** — fold into top-bar chip.
3. **Raw `UserPromptSubmit` row** — replace with full-width prompt divider (anchors rows beneath it as "this turn").
4. **Subagent inner tool events in the main feed** — batch under parent `Task` row.
5. **Four separate scope lists** (edited/created/deleted/read) — collapse into one flat search-first view with a verb column.
6. **`Task` dispatch + `SubagentStart` duplication** — merge when both fire within 3s for same `agent_type`.
7. **Feed as primary view** — becomes a collapsible drawer (see Section 2).

---

## 4. What to add and where

| Addition | Location |
|---|---|
| **S1 status badge** with LOOP chip | top-bar far-left, largest type |
| **S2 "Now" frame** | sticky line directly below badge |
| **Context-window gauge** | thin bar below "Now" frame — % + tokens + model limit |
| **S3 hot-subagent highlight** | in the Observatory; idle subs collapse to count |
| **Scope search + summary line** | single line in scope section |
| Model + session chip | top-bar right (replaces SessionStart row) |
| Relative-time gutter | left side of each feed row — `+0.4s`/`+12s` |
| Collapsed exploration runs | 3+ `Read`/`Grep`/`Glob` in a short window → one expandable `🔎 explored N files` row |
| Error banner rows | any `is_error=true` breaks collapse groups, full-width red |
| Prompt divider | replaces `UserPromptSubmit` row |
| Idle/turn dividers | `──── quiet 42s ────`, `──── turn end · 1m41s ────` |
| Filter chips | above feed when open — `Edit` / `Bash` / `Read-ish` / `Subagents` / `Errors` |
| Feed drawer with auto-expand | collapsed by default; opens on `ERRORED`/`STUCK` or first mutating edit |

---

## 5. Implementation plan (cost-ordered)

### Pre-implementation (verify assumptions) — COMPLETED 2026-04-18

- **P1. Stop-hook reliability check** — Done. 8-session corpus shows: `Stop` fires per-turn reliably (53 Stops observed), but does **not** fire on ctrl-C / abandoned sessions. Implication: `DONE` requires both `Stop` fired **and** no newer activity for > long-idle threshold. Sessions that end without a Stop fall through to `IDLE` automatically.
- **P2. Threshold calibration** — Done. Measured on 400-event / session via transcript-timestamp join. Final numbers:

  | Threshold | Value | Rationale |
  |---|---|---|
  | `WORKING` → `THINKING` idle gap | 30 s | p95 active inter-tool gap is 24s |
  | `IDLE` → `DONE` long-idle | 5 min | Well beyond any observed gap |
  | Exploration-collapse window | 20 s | Covers p95 of consecutive Read/Grep/Glob (12 s) |
  | Loop-detection window | 60 s | p90 tool latency 10 s → 3 retries fit |
  | Hot-subagent rolling window | 60 s | As specified |

  Tool-latency reference (don't false-STUCK long runs): p50 0.4 s · p90 10 s · p95 15 s · max 344 s.

### Cheap (hooks only — ship first wave)
1. Merge Pre/Post feed rows by `tool_use_id`.
2. Hide `SessionStart`; add top-bar chip.
3. Prompt divider for `UserPromptSubmit`.
4. Relative-time gutter.
5. Error banner promotion.
6. Filter chips.
7. Idle/turn dividers.
8. **S1 status badge** — state machine using calibrated thresholds from P2.
9. **S2 "Now" frame** — same state inputs as S1.
10. **Layout radical cut** — collapse feed to drawer; slim Scope Card; restructure top bar.

### Moderate (derived signals — second wave)
11. Collapse exploration runs (window from P2).
12. Batch subagent tool calls under parent `Task` row.
13. **S3 hot-subagent** — 60s rolling count per subagent.
14. Loop detection for `STUCK` state — hash `(tool_name, normalized tool_input)`, count `is_error=true` in 60s window, attach chip on ≥3.
15. Scope search box (client-side filter).
16. Auto-expand-drawer rule when badge hits `ERRORED`/`STUCK`.

### Transcript-reading (third wave)
17. Transcript tailing infra — locate `~/.claude/projects/<slug>/<sessionId>.jsonl`, tail line-by-line, parse latest assistant message's `usage` block only. Never buffer message bodies.
18. **Context-window gauge** — `usage.input_tokens + cache_read_input_tokens` / model limit. Model→limit map table.
19. Token burn-rate anomaly — per-turn deltas vs rolling median; `BURNING` sub-state on badge if >3× MAD.

---

## 6. What we explicitly did NOT add

Agent 2 proposed 12 signals; the 8 below are deferred:

- Tool denial streak · Scope drift / out-of-cwd activity · Subagent fan-out spike · Edit-then-no-verify · Direction change ("abandoned thread") · Bash command escalation (`rm -rf`, etc.) · Subagent silent return · Same-file re-read (subsumed by exploration-run collapse visually; not a separate alert).

Reason: three headline signals + one cost gauge is a product; twelve is a settings page. Add more only when one of these proves to be the wrong headline.

---

## 7. Self-evaluation

A skeptical reviewer would push on:

- **The state-machine is load-bearing.** If S1 gets a state wrong (says `IDLE` during a 5-minute `npm test`, or `STUCK` during legitimate retry), the whole dashboard's trust cracks. Calibration pass P2 is the mitigation; it's now a hard prerequisite, not an optional.
- **Transcript privacy surface.** v2 reads the session JSONL. Even touching only `usage` fields, the reader has the file open — redaction + explicit scope of what we parse needs to be enforced in code, not just in prose.
- **The drawer default is aggressive.** If auto-expand doesn't fire when it should, users who trusted v1's "wall of events" will feel blinded. The auto-expand trigger list (ERRORED, STUCK, first mutating edit) may need expansion after real use.
- **No user testing yet.** Spec is informed by five AI agents reasoning from documented behavior. First actual session under v2 will reveal things none predicted.

Where this lands honestly: **8/10 as a spec** (up from 7/10 after review decisions — calibration + Stop check + transcript commitment removed the three biggest hand-waves). Missing for a 10: (1) ASCII or wireframe mockup of the drawer expanded vs collapsed states, (2) one concrete real-session trace with row counts before/after the Section 3 rules, (3) the calibration numbers from P2 landed into this document instead of `TODO: from P2` placeholders.
