# Buddy Extension

Local terminal companion for Pi, modeled on Claude Code `/buddy`.

## Commands

- `/buddy` - Hatch a buddy on first use, or show the current buddy icon
- `/buddy card` - Show the full buddy card and stats
- `/buddy pet` - Pet the buddy, gaining XP and updating mood
- `/buddy mute` - Keep the buddy visible without speech text in cards
- `/buddy unmute` - Restore buddy speech
- `/buddy off` - Hide the buddy icon without deleting state
- `/buddy help` - Show command help

## Behavior

The extension creates one local buddy with a random name, species, rarity, personality, and stats. Buddy state is cosmetic only: it does not inject agent instructions, change tool access, install MCP servers, or affect model behavior.

When visible, an animated ANSI icon appears on the right side of the input box. The icon is selected from several built-in variants and animates based on mood. The status bar and right-side panel do not show buddy text. On narrow terminals, the icon is hidden to keep the input usable.

## Persistence

Buddy state is global across Pi sessions and stored at:

```text
~/.pi/agent/buddy.json
```

If the state file is invalid, the extension reports an explicit error and does not overwrite it automatically.

Reload extensions with `/reload` after editing.
