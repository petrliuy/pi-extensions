# Undo Extension

`/undo` restores the files changed by the last completed agent turn that used Pi's built-in `edit` or `write` tools. It keeps only one undo snapshot: the next captured edit/write turn replaces the previous one.

It does not use Git. Before an `edit` or `write` tool call runs, the extension snapshots the target file under `~/.pi/agent/undo/`. This allows undoing changes to untracked files and deleting files that were newly created by `write`.

## Commands

- `/undo` - restore the current undo snapshot, with confirmation in interactive mode.
- `/undo show` - show the files in the current undo snapshot.
- `/undo force` - restore even if a file changed again after the captured edit.
- `/undo clear` - remove the current undo snapshot.

## Limits

- Tracks only Pi `edit` and `write` tool calls.
- Only the last completed edit/write turn can be restored.
- Does not track arbitrary shell commands, because shell commands can modify unknown files without exposing paths before mutation.
- By default, skips files changed again after the captured edit to avoid overwriting newer work.
