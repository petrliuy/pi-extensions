# Plan Mode Extension

Read-only exploration mode for safe code analysis, with phase-based model routing.

## Features

- **Read-only tools**: Restricts available tools to read, bash, grep, find, ls, question
- **Bash allowlist**: Only read-only bash commands are allowed
- **Plan extraction**: Extracts numbered steps from `<proposed_plan>` blocks, with legacy `Plan:` fallback
- **Progress tracking**: Widget shows completion status during execution
- **[DONE:n] markers**: Explicit step completion tracking
- **Session persistence**: State survives session resume
- **Phase profiles**: Per-phase override of provider, model, thinking level, tools, and context

## Commands

- `/plan` - Toggle plan mode
- `/todos` - Show current plan progress
- `Alt+I` - Toggle plan mode (shortcut)
- `--plan` - Start Pi in plan mode

## Configuration

Configuration is loaded from `~/.pi/agent/plan.json`. If the file does not exist, built-in defaults are used.

### Phase Profiles

Each phase (`plan`, `execute`, `normal`) has an optional profile with these fields:

| Field      | Type                                                         | Description                                              |
|------------|--------------------------------------------------------------|----------------------------------------------------------|
| `provider` | `string`                                                     | Provider name (e.g. `anthropic`, `openai`)               |
| `model`    | `string`                                                     | Model name (e.g. `claude-4-opus`, `gpt-4o`)              |
| `thinking` | `"off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh"` | Reasoning effort level                                   |
| `tools`    | `string[]`                                                   | Tool allowlist for the phase                             |
| `context`  | `string`                                                     | System prompt injected at phase start                    |

### Defaults

If `plan.json` does not exist or a phase key is missing, the following defaults apply:

| Phase    | Thinking   | Tools                                                       | Context                                            |
|----------|------------|-------------------------------------------------------------|----------------------------------------------------|
| `plan`   | `high`     | `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`       | Prompts strong reasoning, focus on analysis, no edits |
| `execute`| `medium`   | `read`, `bash`, `edit`, `write`                             | Implementation-focused reasoning, minimal diffs    |
| `normal` | `medium`   | `read`, `bash`, `edit`, `write`                             | (none)                                             |

User-provided fields in `plan.json` are shallow-merged over these defaults. Only the fields you specify need to be included.

### Example `~/.pi/agent/plan.json`

```json
{
  "profiles": {
    "plan": {
      "provider": "anthropic",
      "model": "claude-4-opus",
      "thinking": "high",
      "context": "Focus on architecture risks and trade-offs."
    },
    "execute": {
      "provider": "anthropic",
      "model": "claude-4-sonnet",
      "thinking": "low"
    }
  }
}
```

## Usage

1. Enable plan mode with `/plan` or `--plan` flag
2. Ask the agent to analyze code and create a plan
3. The agent should output a numbered plan inside a `<proposed_plan>` block:

```md
<proposed_plan>
# Short Title

## Summary
Brief summary.

## Key Changes
1. First step description
2. Second step description

## Test Plan
1. First verification step
</proposed_plan>
```

4. Choose "Execute the plan" when prompted. Pure analysis responses do not show the execution prompt.
5. During execution, the agent marks steps complete with `[DONE:n]` tags
6. Progress widget shows completion status

## How It Works

### Phase Profiles

The extension defines three phases, each with an independent profile:

- **plan** — read-only exploration with high reasoning effort; switches model if configured
- **execute** — full tool access with implementation-focused reasoning; switches model if configured

When a phase is entered (`togglePlanMode`, executing plan, session resume), the extension:
1. Sets the active tool list via `pi.setActiveTools`
2. Optionally switches thinking level
3. Optionally switches the model via the model registry
4. Injects a context message on the next agent start

If the configured `provider`/`model` pair is not found in the registry, a warning notification is shown and the current model is kept.

### Plan Mode (Read-Only)
- Only read-only tools available
- Bash commands filtered through allowlist
- Requests to implement, edit, continue, or apply changes are treated as planning requests
- Agent creates a `<proposed_plan>` without making changes
- Blocked write commands explicitly instruct the agent to stop retrying write-capable shell commands and produce a plan instead

### Execution Mode
- Full tool access restored
- Agent executes steps in order
- `[DONE:n]` markers track completion
- Widget shows progress
- When all steps are marked done, a completion message is sent and mode returns to `normal`

### Session Restore

State (enabled mode, todo items, executing flag, active phase) is persisted to session entries. On `session_start`:

1. The last `plan-mode` entry is loaded
2. If resuming an active execution, the extension scans messages since the last `plan-mode-execute` entry for `[DONE:n]` markers and updates todo completion, so progress is not lost across restarts
3. The active phase profile is reapplied (tools, thinking, model)

### Command Allowlist

Safe commands (allowed):
- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- System info: `uname`, `whoami`, `date`, `uptime`

Blocked commands:
- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Editors: `vim`, `nano`, `code`

## Status Bar

The status indicator shows different information per phase:

| Mode        | Indicator                                                     |
|-------------|---------------------------------------------------------------|
| `plan`      | `⏸ plan` (warning color)                                      |
| `execute`   | `📋 3/5` (accent color) with progress count                   |
| `normal`    | Hidden                                                        |

If a profile overrides `provider`/`model`, the status shows `⏸ anthropic/claude-4-opus`.
If a profile overrides `thinking`, the status shows `⏸ plan high`.

A widget (`plan-todos`) renders the full todo list at the bottom of the UI, with completed items struck through and shown in muted color.
