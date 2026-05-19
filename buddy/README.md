# Buddy Extension

Local terminal companion for Pi, modeled on Claude Code `/buddy`.

## Commands

- `/buddy` - Hatch a buddy on first use, or show the current buddy
- `/buddy card` - Show the full buddy card and stats
- `/buddy pet` - Pet the buddy, gaining XP and updating mood
- `/buddy mute` - Hide buddy speech while keeping the widget visible
- `/buddy unmute` - Restore buddy speech
- `/buddy off` - Hide the buddy status and widget without deleting state
- `/buddy help` - Show command help

## Behavior

The extension creates one local buddy with a random name, species, rarity, personality, and stats. Buddy state is cosmetic only: it does not inject agent instructions, change tool access, install MCP servers, or affect model behavior.

When visible, the status bar shows `buddy <name> L<level>`. A compact widget shows ASCII art, rarity, species, mood, XP, and speech when unmuted.

## Persistence

Buddy state is global across Pi sessions and stored at:

```text
~/.pi/agent/buddy.json
```

If the state file is invalid, the extension reports an explicit error and does not overwrite it automatically.

Reload extensions with `/reload` after editing.
