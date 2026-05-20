# Buddy Extension

Local terminal companion for Pi, modeled on Claude Code `/buddy`.

## Commands

- `/buddy` - Hatch a buddy on first use, or show the current buddy icon
- `/buddy card` - Show the full buddy card and stats
- `/buddy pet` - Pet the buddy, gaining XP and briefly showing heart or celebrate animation
- `/buddy idle` - Show the idle animation
- `/buddy sleep` - Show the sleep animation
- `/buddy busy` - Show the busy animation
- `/buddy attention` - Show the attention animation
- `/buddy celebrate` - Show the celebrate animation
- `/buddy dizzy` - Show the dizzy animation
- `/buddy heart` - Show the heart animation
- `/buddy next` - Switch to the next buddy species
- `/buddy species` - List available species
- `/buddy species <name>` - Switch to a specific species
- `/buddy mute` - Keep the buddy visible without speech text in cards
- `/buddy unmute` - Restore buddy speech
- `/buddy off` - Hide the buddy icon without deleting state
- `/buddy help` - Show command help

## Behavior

The extension creates one local buddy with a random species, rare-or-better rarity, personality, and stats. Rarity is shown by color in the right-side icon. Buddy state is cosmetic only: it does not inject agent instructions, change tool access, install MCP servers, or affect model behavior.

When visible, an animated ANSI icon appears on the right side of the input box and animates through Claude Desktop Buddy-style states: sleep, idle, busy, attention, celebrate, dizzy, and heart. The icon keeps two spaces from the terminal's right edge. The status bar and right-side panel do not show buddy text. On narrow terminals, the icon is hidden to keep the input usable.

Available species are adapted from Anthropic's MIT-licensed `claude-desktop-buddy`: capybara, duck, goose, blob, cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, cactus, robot, rabbit, mushroom, and chonk.

## Persistence

Buddy state is global across Pi sessions and stored at:

```text
~/.pi/agent/buddy.json
```

Version 1 state files are migrated automatically to the multi-species format. If the state file is invalid, the extension reports an explicit error and does not overwrite it automatically.

Reload extensions with `/reload` after editing.
