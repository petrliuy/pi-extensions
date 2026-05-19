# Pi Extensions

Local Pi agent extensions for `~/.pi/agent/extensions`.

Pi auto-discovers directory-style extensions from `~/.pi/agent/extensions/*/index.ts`. After editing an auto-discovered extension, reload Pi with `/reload`.

Official extension docs: https://pi.dev/docs/latest/extensions

## Extensions

- `plan/` - Plan Mode extension for read-only exploration, plan extraction, todo progress, and execution handoff.
- `review/` - Focused read-only review command for current changes or a specified scope.
- `goal/` - Persistent task goal tracking modeled on Codex `/goal`.

## Usage

- Toggle Plan Mode with `/plan`.
- Show current plan progress with `/todos`.
- Start Pi in Plan Mode with `--plan`.
- Review current changes with `/review` or a scope with `/review <scope>`.
- Set a persistent goal with `/goal <objective>`, pause/resume it with `/goal pause` and `/goal resume`, or clear it with `/goal clear`.

See `plan/README.md` for detailed Plan Mode behavior and command allowlist notes, `review/README.md` for review command behavior, and `goal/README.md` for goal tracking behavior.
