# Plan Mode Extension

Read-only exploration mode for safe code analysis, with phase-based model routing.

## Features

- **Read-only tools**: Restricts available tools to read, bash, grep, find, ls, questionnaire, and propose_plan
- **Bash allowlist**: Only read-only bash commands are allowed
- **Write-tool hard block**: Blocks edit, write, and apply_patch tool calls while Plan Mode is active
- **Structured plan approval**: Uses the `propose_plan` tool to submit executable JSON-shaped plans and trigger the harness approval UI
- **Structured task progress**: Uses `plan_task_update` during execution; `[DONE:n]` remains a legacy fallback
- **Plan extraction fallback**: Extracts numbered steps from `<proposed_plan>` blocks, with legacy `Plan:` fallback
- **Blocked-command handoff**: Captures blocked write commands as structured todos so execution can be approved explicitly
- **Auto-continuation**: Continues approved execution while structured task progress is reported, with two no-progress retry turns and a safety limit
- **Progress tracking**: Widget shows completion status during execution
- **[DONE:n] markers**: Explicit step completion tracking
- **Session persistence**: State survives session resume
- **Phase profiles**: Per-phase override of provider, model, thinking level, tools, and context

## Commands

- `/plan` - Toggle plan mode
- `/execute` - Confirm and execute the current plan or captured blocked command
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
| `plan`   | `high`     | `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`, `propose_plan` | Prompts strong reasoning, focus on analysis, no edits |
| `execute`| `medium`   | `read`, `bash`, `edit`, `write`, `plan_task_update`          | Implementation-focused reasoning, minimal diffs    |
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
3. For implementation, fix, or refactor requests, the agent should call `propose_plan` with `title`, `summary`, ordered `steps`, optional `verification`, optional `risks`, and optional `files`.

4. Choose `Execute with auto edits`, `Execute with manual review`, `Keep planning`, or `Edit plan` when prompted. `/execute` opens the same confirmation UI for the current plan or captured blocked command.
5. During execution, the agent updates task state with `plan_task_update` (`pending`, `in_progress`, `completed`, or `blocked`).
6. If more steps remain, Plan Mode automatically sends a continuation follow-up. If a turn forgets to report task progress, Plan Mode retries twice with a stronger progress reminder before pausing.
7. Progress widget shows completion status.

The execution prompt appears when the agent calls `propose_plan`, when the last assistant response contains extractable legacy plan steps, or when Plan Mode captures a blocked write command. Confirming execution sends a follow-up handoff turn so approval made from the UI starts reliably. Plain yes/no chat replies are not treated as approval. If the agent emits malformed plan markup, Plan Mode asks for one format-repair turn and then warns the user if extraction still fails.

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

Plan phase tools are always constrained to the built-in read-only allowlist, and `propose_plan` is always enabled so structured approval remains available. Execute phase always includes `plan_task_update` so progress remains structured. If `~/.pi/agent/plan.json` configures write-capable tools such as `edit` or `write` for the `plan` phase, they are ignored and a warning is shown.

### Plan Mode (Read-Only)
- Only read-only tools available
- `edit`, `write`, and `apply_patch` tool calls are hard-blocked even if they are accidentally exposed
- Bash commands filtered through allowlist
- Requests to implement, edit, continue, or apply changes are treated as planning requests
- Agent calls `propose_plan` without making changes
- Legacy `<proposed_plan>` / `Plan:` text extraction remains as a fallback
- Blocked write commands explicitly instruct the agent to stop retrying write-capable shell commands and produce a plan instead
- `/execute` provides an explicit user-controlled handoff into execution mode
- `/plan` cannot toggle modes while execution is active

### Execution Mode
- Full tool access restored
- Agent executes steps in order
- `plan_task_update` tracks task state by stable task id
- `[DONE:n]` markers are accepted only as a compatibility fallback
- Automatic continuation sends the next execution follow-up while steps remain and progress is being marked
- No-progress turns get two automatic retries before Plan Mode pauses and asks for `/execute`
- Tasks marked `blocked` still pause immediately
- `/execute` resumes an active incomplete execution instead of only reporting that execution is already active
- Widget shows progress
- When all steps are marked done, a completion message is sent and mode returns to `normal`

### Session Restore

State (enabled mode, todo items, executing flag, active phase, pending plan, execution choice, continuation count, and no-progress continuation count) is persisted to session entries. On `session_start`:

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
