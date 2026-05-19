# Loop Extension

Scheduled loop tasks for Pi.

## Commands

- `/loop <natural language schedule and task>` - Create and start a loop task
- `/loop list` - List active and paused loops
- `/loop status [id]` - Show all loops or one loop
- `/loop show <id>` - Show a loop's full prompt and latest summary
- `/loop pause <id>` - Pause a loop
- `/loop resume <id>` - Resume a paused loop and schedule the next run
- `/loop stop <id>` - Stop a loop and remove it from the active list
- `/loop rm <id>` - Remove a loop from the active list
- `/loop delete <id>` - Remove a loop from the active list
- `/loop help` - Show command help

Example:

```text
/loop 每天8点查找我的邮件
/loop 每隔5分钟检查项目状态
/loop check my mail every day at 8
/loop summarize git status every 2 hours
```

## Behavior

The extension keeps a lightweight in-memory scheduler. When a loop is due, it sends a user message that asks the agent to run the scheduled prompt once and finish with one of:

- `[LOOP:<id>:done]`
- `[LOOP:<id>:blocked]`

Only one loop turn is triggered at a time. If the agent is already running when a loop becomes due, the loop is marked pending and is triggered after the current turn ends.

Loop state is persisted to session entries and restored on session resume.

## Status

The status bar shows active and paused loop counts. A widget shows up to five loops with id, interval, next run, and run count.

## Notes

This extension schedules natural-language agent tasks. It does not execute shell commands directly, implement cron syntax, infer vague schedules, or run multiple loop turns concurrently.
