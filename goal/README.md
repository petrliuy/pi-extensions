# Goal Extension

Persistent, autonomous task-goal mode for Pi, modeled on Codex `/goal` and the
architecture of [`@narumitw/pi-goal`](https://pi.dev/packages/@narumitw/pi-goal)
(MIT — prompt wording and validation patterns adapted from that project).

Unlike a "context injection" goal, this extension drives the agent to keep
working across turns until the goal is verifiably complete or truly blocked.

## Commands

```
/goal <objective>        Set a goal and start pursuing it
/goal                    Show the current goal (status, id, turn count)
/goal edit <objective>   Update the objective without resetting the goal id guard
/goal pause              Stop pursuit; keep the goal attached (aborts auto-continuation)
/goal resume             Resume a paused/blocked goal (rotates the goal id)
/goal clear              Remove the goal entirely
```

Objectives must be non-empty and at most 4000 characters. For longer
instructions, put the details in a file and point the goal at that file.

## Completion and blocking (tools, not text markers)

Completion and impasse are reported through dedicated tools instead of fragile
text markers the model has to remember to emit:

- **`goal_complete({ goal_id, summary })`** — mark the goal complete. Rejected
  when there is no active goal, the `goal_id` is stale/missing, the goal is not
  active, the summary is empty, or the summary contradicts itself
  (`not complete`, `tests still fail`, …).
- **`goal_blocked({ goal_id, reason, evidence, repeated_turns })`** — mark a
  true impasse. Requires the same blocker to recur for **at least 3 consecutive
  goal turns**, with concrete evidence and a specific user/external action.
  Ordinary clarification, uncertainty, or recoverable failures are rejected.

Both tools `terminate` the turn on success.

## goal_id stale-turn guard

Every goal gets a unique `goal_id` that is injected into the system prompt. The
id is **rotated on set, resume, and edit**, so a delayed turn from an older,
replaced, or stopped goal cannot complete a newer goal instance — `goal_complete`
/ `goal_blocked` reject any id that does not match the current goal.

## Autonomous continuation

While a goal is active, each normally-ending turn schedules one continuation.
That continuation is dispatched from Pi's `agent_settled` boundary (Pi `0.80.6+`)
only when the session is idle, so retries, compaction, steering, and queued
follow-ups drain first. The loop stops when the goal becomes `complete`,
`blocked`, `paused`, or `cleared`, or when a turn is aborted (→ `paused`) or
ends in a terminal error (→ `blocked`). Continuation user messages carry a
marker that the `context` handler elides from model history, so long autonomous
runs do not bloat context — the system prompt re-establishes the goal each turn.

## Prompt safeguards

The injected goal block marks the objective as **user-provided task data** (a
trust boundary against prompt injection via the objective text) and requires an
evidence-based, requirement-by-requirement completion audit before
`goal_complete` is called.

## States

- `active` — pursuing (auto-continues)
- `paused` — user paused or turn aborted
- `blocked` — true impasse or terminal agent error
- `complete` — `goal_complete` accepted

The status bar shows `goal <state>`; a widget shows the objective and
`<state> · turn N`. State is persisted to session entries and restored on
session resume.

## Migration

Legacy persisted goals (text-marker based, statuses `pursuing` / `achieved` /
`unmet`) are migrated on restore to the new shape and statuses, with a fresh
`goal_id` and `iteration` backfilled.

## Out of scope

No token budget, no ordered goal queue, no tool-visibility toggles. Single-file,
functional style; the two goal tools are always registered and reject cleanly
when no goal is active.
