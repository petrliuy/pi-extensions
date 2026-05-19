# Review Extension

Focused read-only review command for Pi.

## Commands

- `/review` - Review the current working tree changes
- `/review <scope>` - Review a specific scope, for example `/review plan/index.ts`

## Behavior

The command triggers a review turn with read-only tools enabled:

- `read`
- `bash`
- `grep`
- `find`
- `ls`

The injected review context asks the agent to inspect relevant diffs and files, prioritize correctness/security/contract risks, avoid style-only findings, and return either severity-ranked issues or an explicit no-blocking-issues result.

The command does not switch models. It temporarily raises the thinking level to `high` for the review turn, then restores the previous thinking level and active tool set when available.

Reload extensions with `/reload` after editing.
