# Init Extension

Project instruction initialization for Codex and Claude Code.

## Commands

- `/init` - Initialize Codex-style `AGENTS.md`
- `/init codex` - Same as `/init`
- `/init claude` - Initialize shared Claude `CLAUDE.md`
- `/init claude local` - Initialize `CLAUDE.md`, `CLAUDE.local.md`, and gitignore the local file
- `/init claude project` - Initialize `CLAUDE.md` plus a project `.claude/` structure
- `/init claude all` - Initialize shared, local, and `.claude/` Claude files
- `/init help` - Show command help

Slash-separated variants such as `/init claude/all` are also accepted.

## Behavior

The extension parses the requested target and sends an agent task. The agent then inspects the active project before creating or updating files, so generated guidance can reflect the actual repository instead of a fixed template.

Default behavior follows Codex CLI: `/init` creates or updates `AGENTS.md`.

Claude local/project modes require `.gitignore` updates for local-only files:

- `CLAUDE.local.md`
- `.claude/settings.local.json`
- `.claude/worktrees/`

Existing instruction files should be preserved and updated with the smallest useful change.

Reload extensions with `/reload` after editing.
