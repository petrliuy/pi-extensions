# Plan Mode Extension

Planning mode for safe code analysis, with a read-only bash allowlist, phase-based model routing, and a centralized state machine.

## State Machine

```
normal ──/plan──→ planning ──propose_plan──→ approval ──Execute──→ executing ──all done──→ normal
                     ↑                          │  │                                      │
                     │        ┌──dismiss/Escape──┘  └──Quit──→ normal                       │
                     │        ├──view──→ approval                                          │
                     │        └──edit/save──→ executing; cancel stays in approval          │
                     └──toggle──────────────────────────blocked/limit──→ normal
```

All transitions are centralized in `transition()` (`constants.ts`). Event handlers emit `PlanEvent` values; `transition()` returns the new mode + actions; callers execute them via `executeActions()`.

States: `normal | planning | approval | executing`

## Features

- **Centralized state machine**: All mode transitions go through `transition(mode, event) → { mode, actions[] }`
- **Broad planning tools**: Keeps configured plan tools available and always adds `propose_plan`
- **Read-only bash allowlist**: Auto-allows known read-only commands, asks for confirmation on non-whitelisted commands, and supports manual exact/prefix extensions
- **Write-tool hard block**: Blocks edit, write, and apply_patch tool calls while Plan Mode is active
- **Structured plan approval**: Uses the `propose_plan` tool to submit visible JSON-shaped plans and trigger the harness approval UI
- **Structured task progress**: Uses `plan_task_update` during execution as the canonical progress protocol
- **Blocked-command handoff**: Captures blocked write commands as structured todos so execution can be approved explicitly
- **Auto-continuation**: Continues approved execution while structured task progress is reported, with two no-progress retry turns and a safety limit
- **Progress tracking**: Widget shows completion status during execution
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
| `instructions` | `string[]`                                               | Extra phase instructions appended as bullets             |
| `planCommandAllow` | `{ exact?: string[], prefixes?: string[] }`             | Extra Plan Mode bash commands to auto-allow             |

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
      "context": "Focus on architecture risks and trade-offs.",
      "instructions": [
        "Plan Mode is read-only by default.",
        "Put checks that may write caches or generated files into proposal verification."
      ],
      "planCommandAllow": {
        "exact": ["npm --prefix ../npm list"],
        "prefixes": ["npm --prefix ../npm view"]
      }
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
3. For implementation, fix, or refactor requests, the agent applies a clarification gate: ask for material user decisions that repo context cannot answer, then call `propose_plan` with `title`, `summary`, ordered `steps`, optional `assumptions`, optional `verification`, optional `risks`, and optional `files`. The `summary` should capture key code findings, constraints, and implementation judgment needed during execution.
4. Review the visible proposal, then choose `Execute plan`, `View full plan`, `Edit plan`, or `Quit plan`. `View full plan` opens the complete text and returns to approval when closed. Execution starts automatically after approval; saving an edited plan also starts execution with the edited steps.
5. During execution, the agent updates task state with `plan_task_update` (`pending`, `in_progress`, `completed`, or `blocked`).
6. If more steps remain, Plan Mode automatically sends hidden continuation follow-ups. If a turn forgets to report task progress, Plan Mode retries twice with a stronger hidden reminder before marking execution blocked.
7. The status bar shows completion count, and the progress widget shows only the current or next step.

The approval prompt appears when the agent calls `propose_plan`; after approval, execution context includes compact approved plan metadata plus remaining steps. `View full plan` opens the same proposal text in a larger viewer and ignores any edits made there; only `Edit plan` mutates the pending plan. Blocked commands captured during planning use a minimal step-list handoff. Confirming execution or saving an edited plan sends a hidden follow-up handoff turn so approval made from the UI starts reliably without adding protocol noise to the chat. Plain yes/no chat replies are not treated as approval. Pressing Esc/Ctrl+C in the approval/edit UI closes that UI while keeping the pending plan available. Running `/plan` during execution clears the active execution state and exits Plan Mode.

## How It Works

### State Machine

All state transitions are centralized in `transition(mode, event)` in `constants.ts`. The function is pure — it returns a new mode and a list of `TransitionAction` values, with no side effects. Event handlers call `transition()`, update `state.mode`, then execute the returned actions via `executeActions()`.

Transition table:

| From | Event | To | Actions |
|------|-------|----|---------|
| `normal` | `TOGGLE` | `planning` | reset, apply phase, notify |
| `planning` | `TOGGLE` | `normal` | reset, apply phase, notify |
| `planning` | `PROPOSE` | `approval` | persist, update status, show approval UI |
| `planning` | `BLOCKED_CMD` | `approval` | persist, update status, show approval UI |
| `approval` | `EXECUTE` | `executing` | apply phase, persist, update status |
| `approval` | `VIEW` | `approval` | caller opens viewer; close returns to approval |
| `approval` | `EDIT` | `approval`/`executing` | caller handles editor; cancel stays in approval, saving starts execution |
| `approval` | `PLAN_EDITED` | `approval` | persist, show approval UI |
| `approval` | `DISMISS` | `planning` | persist, update status |
| `approval` | `QUIT` | `normal` | reset, apply phase, notify |
| `executing` | `ALL_COMPLETE` | `normal` | finish execution (success) |
| `executing` | `TASK_BLOCKED` | `normal` | finish execution (blocked) |
| `executing` | `CONTINUE` | `executing` | persist, update status, send handoff |
| `executing` | `NO_PROGRESS_RETRY` | `executing` | persist, update status, send no-progress continuation |
| `executing` | `CONTINUATION_LIMIT` | `normal` | finish execution (blocked) |

### Phase Profiles

The extension defines three phases, each with an independent profile:

- **plan** — planning and exploration with read-only bash checks and high reasoning effort; switches model if configured
- **execute** — full tool access with implementation-focused reasoning; switches model if configured

When a phase is entered (`togglePlanMode`, executing plan, session resume), the extension:
1. Sets the active tool list via `pi.setActiveTools`
2. Optionally switches thinking level
3. Optionally switches the model via the model registry
4. Injects a context message on the next agent start

If the configured `provider`/`model` pair is not found in the registry, a warning notification is shown and the current model is kept.

Plan phase keeps the configured tool list and always adds `propose_plan` so structured approval remains available. Write tools may be visible, but `edit`, `write`, and `apply_patch` are hard-blocked while Plan Mode is active. Bash commands use a read-only allowlist, optional manual allowlist, and user confirmation for non-whitelisted commands. Execute phase always includes `plan_task_update` so progress remains structured.

### Plan Mode
- Configured plan tools remain available, with `propose_plan` always added
- Plan Mode instructions tell the agent to default to read-only inspection and move uncertain checks into the proposal
- `edit`, `write`, and `apply_patch` tool calls are hard-blocked
- Built-in read-only bash commands auto-run; non-whitelisted bash commands ask for confirmation in UI mode and block in non-UI mode
- Repeated safe commands can be added to `profiles.plan.planCommandAllow`
- Requests to implement, edit, continue, or apply changes are treated as planning requests
- Agent asks clarifying questions when material user decisions cannot be inferred from local context
- If it does not ask, `assumptions` should explain low-risk defaults and why no material clarification was needed
- Agent calls `propose_plan` without making changes
- Approved structured proposals are retained through execution and injected as compact execution context
- Blocked write commands explicitly instruct the agent to stop retrying write-capable shell commands and produce a plan instead
- The approval UI provides the user-controlled handoff into execution mode
- Cancelling the approval/edit UI keeps the pending plan instead of clearing it
- `/plan` during execution clears the active execution state and exits Plan Mode

### Execution Mode
- Full tool access restored
- Agent executes steps in order
- `plan_task_update` tracks task state by stable task id
- Automatic continuation sends the next execution follow-up while steps remain and progress is being marked
- No-progress turns get two automatic retries before Plan Mode marks execution blocked and clears the active state
- Tasks marked `blocked` stop execution immediately and clear the active state
- Completing the final task terminates the current agent turn immediately; `agent_end` then sends completion and returns to `normal`
- Widget shows progress
- When all steps are marked done, a completion message is sent and mode returns to `normal`

### Session Restore

State is persisted with `schemaVersion`, a single `mode` value (`normal`, `planning`, `approval`, or `executing`), todo items, pending plan data, blocked command data, continuation count, and no-progress continuation count. On `session_start`:

1. The last `plan-mode` entry is loaded
2. Legacy entries with `enabled`, `executing`, or `phase` are migrated into the single-mode state
3. Legacy `format_repair` mode is migrated to `planning`
4. If resuming an active execution, the extension trusts persisted task state
5. The active phase profile is derived from `mode` and reapplied (tools, thinking, model)

### Bash Guard

Plan Mode uses a simple exact/prefix allowlist model instead of trying to detect every possible side effect:
- Built-in exact and prefix commands are allowed, including common search, file inspection, Git inspection, and package metadata commands.
- Simple chains and pipelines using `&&`, `||`, `|`, or `;` are allowed only when every segment is allowlisted.
- Redirects are not auto-allowed, except stderr suppression such as `2>/dev/null`; backticks and `$()` are not auto-allowed.
- Dependency installs, Git mutations, service/process/database commands, and unknown commands are not auto-allowed unless manually added.
- In UI mode, non-whitelisted bash commands ask for confirmation only when the agent believes they are read-only inspection commands.
- Commands that may change local or external state should be moved into the proposal and run only after execution approval.
- In non-UI mode, non-whitelisted bash commands are blocked and should be moved into `propose_plan.verification`.

Add recurring safe project-specific commands to `profiles.plan.planCommandAllow` in `~/.pi/agent/plan.json`. Use `exact` for full command matches and `prefixes` for command starts such as `npm --prefix ../npm list`. Use `profiles.plan.instructions` for behavior guidance, and `planCommandAllow` only for commands that should auto-run in Plan Mode. `/undo` remains limited to approved `edit`/`write` file changes and does not roll back shell mutations.

## Status Bar

The status indicator shows different information per phase:

| Mode        | Indicator                                                     |
|-------------|---------------------------------------------------------------|
| `plan`      | `⏸ plan` (warning color)                                      |
| `execute`   | `📋 3/5` (accent color) with progress count                   |
| `normal`    | Hidden                                                        |

If a profile overrides `provider`/`model`, the status shows `⏸ anthropic/claude-4-opus`.
If a profile overrides `thinking`, the status shows `⏸ plan high`.

A widget (`plan-todos`) renders only the current in-progress step, blocked step, or next pending step. Full task details remain available through `/todos`.
