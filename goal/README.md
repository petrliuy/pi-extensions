# Goal Extension

Persistent task goal support for Pi, modeled on Codex `/goal`.

## Commands

- `/goal <objective>` - Set a persistent goal and start pursuing it
- `/goal` - Show the current goal
- `/goal pause` - Pause pursuit while keeping the goal attached to the session
- `/goal resume` - Resume pursuit of the current goal
- `/goal clear` - Remove the current goal

Objectives must be non-empty and at most 4000 characters. For longer instructions, put the details in a file and point the goal at that file.

## Behavior

When a goal is pursuing, the extension injects hidden context before each agent turn:

- Keep the objective active across turns
- Inspect before changing behavior
- Make focused progress with small safe changes
- Verify before declaring the goal achieved
- Mark completion with `[GOAL:achieved]`
- Mark concrete blockers with `[GOAL:unmet]`

Paused goals remain visible in session state but are not pursued until resumed.

## Status

The status bar shows one of:

- `goal pursuing`
- `goal paused`
- `goal achieved`
- `goal unmet`

A small widget shows the active objective and status. Goal state is persisted to session entries and restored on session resume.

## Notes

This extension implements Pi-side goal tracking and instruction injection. It does not implement Codex runtime features such as budget accounting or autonomous continuation beyond Pi's normal turn lifecycle.
