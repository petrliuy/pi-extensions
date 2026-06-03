# Plan Mode Extension

Planning mode for safe code analysis, with side-effect guards and phase-based model routing.

## Features

- **Broad planning tools**: Keeps configured plan tools available and always adds propose_plan
- **Side-effect guard**: Blocks bash commands that may change files, dependencies, git state, processes, or system state
- **Write-tool hard block**: Blocks edit, write, and apply_patch tool calls while Plan Mode is active
- **Structured plan approval**: Uses the `propose_plan` tool to submit visible JSON-shaped plans and trigger the harness approval UI
- **Structured task progress**: Uses `plan_task_update` during execution; `[DONE:n]` remains a legacy fallback
- **Codex-style clarification**: Inspects first, asks high-impact questions when needed, and records skipped defaults as assumptions
- **Structured refinement**: `Refine planning` asks whether to supplement or redefine the current plan, then sends the current proposal plus the refinement request back through `propose_plan`
- **Plan extraction fallback**: Extracts numbered steps from `<proposed_plan>` blocks, with legacy `Plan:` fallback
- **Blocked-command handoff**: Captures blocked write commands as structured todos so execution can be approved explicitly
- **Auto-continuation**: Continues approved execution while structured task progress is reported, with two no-progress retry turns and a safety limit
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
| `tools`    | `string[]`                                                   | Active tools for the phase                              |
| `context`  | `string`                                                     | System prompt injected at phase start                    |

### Defaults

If `plan.json` does not exist or a phase key is missing, the following defaults apply:

| Phase    | Thinking   | Tools                                                       | Context                                            |
|----------|------------|-------------------------------------------------------------|----------------------------------------------------|
| `plan`   | `high`     | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `questionnaire`, `propose_plan` | Prompts strong reasoning, focus on analysis, no edits |
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
3. For implementation, fix, or refactor requests, the agent should ask high-impact questions when repo context cannot answer them, then call `propose_plan` with `title`, `summary`, ordered `steps`, optional `assumptions`, optional `verification`, optional `risks`, and optional `files`. The `summary` should capture key code findings, constraints, and implementation judgment needed during execution.

4. Review the full visible proposal, then choose `Execute plan`, `Refine planning`, or `Edit plan`. `Refine planning` starts a structured refinement flow where you choose whether to supplement or redefine the plan before entering the refinement request. Execution starts automatically after approval.
5. During execution, the agent updates task state with `plan_task_update` (`pending`, `in_progress`, `completed`, or `blocked`).
6. If more steps remain, Plan Mode automatically sends a continuation follow-up. If a turn forgets to report task progress, Plan Mode retries twice with a stronger progress reminder before marking execution blocked.
7. Progress widget shows completion status.

The approval prompt appears with the full proposal when the agent calls `propose_plan`; after approval, execution context includes compact approved plan metadata plus remaining steps. Legacy extracted steps and captured blocked commands still use a minimal step-list handoff. Confirming execution sends a short follow-up handoff turn so approval made from the UI starts reliably. Plain yes/no chat replies are not treated as approval. Pressing Esc/Ctrl+C in the approval/refinement/edit UI closes that UI while keeping the pending plan available. If the agent emits malformed plan markup, Plan Mode asks for one format-repair turn and then warns the user if extraction still fails.

Refinement is a proposal revision flow, not execution. When you choose `Refine planning`, Plan Mode sends the current plan, the selected refinement mode, and your refinement text as a queued follow-up. The agent must respond with one complete revised proposal through `propose_plan`; it should not emit partial patches or execute commands during refinement.

## How It Works

### Phase Profiles

The extension defines three phases, each with an independent profile:

- **plan** — planning and exploration with side-effect guards and high reasoning effort; switches model if configured
- **execute** — full tool access with implementation-focused reasoning; switches model if configured

When a phase is entered (`togglePlanMode`, executing plan, session resume), the extension:
1. Sets the active tool list via `pi.setActiveTools`
2. Optionally switches thinking level
3. Optionally switches the model via the model registry
4. Injects a context message on the next agent start

If the configured `provider`/`model` pair is not found in the registry, a warning notification is shown and the current model is kept.

Plan phase keeps the configured tool list and always adds `propose_plan` so structured approval remains available. Write tools may be visible, but `edit`, `write`, `apply_patch`, and side-effectful bash commands are hard-blocked while Plan Mode is active. Execute phase always includes `plan_task_update` so progress remains structured.

### Plan Mode
- Configured plan tools remain available, with `propose_plan` always added
- `edit`, `write`, and `apply_patch` tool calls are hard-blocked
- Bash commands that may change files, dependencies, git state, processes, or system state are blocked
- Requests to implement, edit, continue, or apply changes are treated as planning requests
- Agent asks clarifying questions when product intent, scope, success criteria, or tradeoffs cannot be inferred from local context
- If it does not ask, skipped defaults are rendered in the proposal as `assumptions`
- Agent calls `propose_plan` without making changes
- Approved structured proposals are retained through execution and injected as compact execution context
- Refinements carry the current proposal forward and require a complete revised `propose_plan` response
- Legacy `<proposed_plan>` / explicit plan-step text extraction remains as a fallback
- Blocked write commands explicitly instruct the agent to stop retrying write-capable shell commands and produce a plan instead
- The approval UI provides the user-controlled handoff into execution mode
- Cancelling the approval/refinement/edit UI keeps the pending plan instead of clearing it
- `/plan` clears stale execution state and starts a fresh planning session

### Execution Mode
- Full tool access restored
- Agent executes steps in order
- `plan_task_update` tracks task state by stable task id
- `[DONE:n]` markers are accepted only as a compatibility fallback
- Automatic continuation sends the next execution follow-up while steps remain and progress is being marked
- No-progress turns get two automatic retries before Plan Mode marks execution blocked and clears the active state
- Tasks marked `blocked` stop execution immediately and clear the active state
- Widget shows progress
- When all steps are marked done, a completion message is sent and mode returns to `normal`

### Session Restore

State is persisted with `schemaVersion`, a single `mode` value (`normal`, `planning`, `approval`, `refining`, `executing`, or `format_repair`), todo items, pending plan data, blocked command data, continuation count, and no-progress continuation count. On `session_start`:

1. The last `plan-mode` entry is loaded
2. Legacy entries with `enabled`, `executing`, `phase`, or `formatRepairAttempted` are migrated into the single-mode state
3. If resuming an active execution, the extension trusts persisted task state first and only scans assistant messages after the last persisted `plan-mode` entry for compatibility `[DONE:n]` markers
4. The active phase profile is derived from `mode` and reapplied (tools, thinking, model)

### Side-Effect Guard

Plan Mode does not use a narrow bash allowlist. It tokenizes shell commands and blocks obvious side-effect commands, write subcommands, redirection, and in-place edit flags while allowing those words inside read/search arguments:
- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`, including common global-option forms such as `git -C repo reset`
- Package install: `npm install`, `yarn add`, `pip install`, including common prefix/cwd option forms
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
