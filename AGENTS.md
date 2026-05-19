# Repository Guidelines

## Project Structure & Module Organization

This repository contains Pi extensions in `~/.pi/agent/extensions`. Pi auto-discovers directory-style extensions from `~/.pi/agent/extensions/*/index.ts`; `plan/index.ts` is the Plan Mode entry point.

- `README.md` is the root overview.
- `plan/` contains the Plan Mode extension and its README.
- `plan/index.ts` registers extension behavior.
- `plan/utils.ts` contains pure allowlist and plan/todo helpers.

Keep extension-specific code inside its module. Only add shared helpers after a second extension needs them.

## Extension Development

Extensions are TypeScript modules loaded by Pi without a separate compile step. Reload auto-discovered extensions with `/reload`.

Official reference: https://pi.dev/docs/latest/extensions

The latest Pi docs show imports from `@earendil-works/...`, while local code imports `@mariozechner/...`. Follow existing imports unless intentionally updating package versions.

No local `package.json`, `tsconfig.json`, or test script exists in `extensions/`; the nearest package context is `../npm`.

Useful local inspection commands:

- `rg --files`
- `rg "pattern" plan`
- `git diff -- AGENTS.md plan`
- `npm --prefix ../npm list` checks parent package dependencies.

If the parent project exposes build or test scripts, prefer `npm --prefix ../npm run <script>`.

## Coding Style & Naming Conventions

Use TypeScript with exported types for module contracts. Preserve current style: tabs, double quotes, semicolons, and named helper functions. Name extension directories and command IDs in lowercase kebab-style, such as `plan` and `/todos`.

## Testing Guidelines

Tests are not currently present. If added, prefer `plan/utils.test.ts` and prioritize pure helpers in `plan/utils.ts`: `isSafeCommand`, `extractTodoItems`, `extractDoneSteps`, and `markCompletedSteps`. Include allowed and blocked commands, malformed plan text, markdown formatting, and invalid `[DONE:n]` markers.

Until a test runner exists, verify manually with `/reload`, `/plan`, `/todos`, and startup with `--plan`.

## Commit & Pull Request Guidelines

No formal commit convention is established. Use short imperative subjects, for example `Update extension contributor guide`.

Pull requests should include a concise behavior summary, touched paths, validation steps, and screenshots or terminal snippets for UI changes.

## Security & Configuration Tips

Extensions run with full local permissions and can intercept or execute tools, so command allowlists and tool interception are security-sensitive. Treat changes to `DESTRUCTIVE_PATTERNS`, `SAFE_PATTERNS`, and tool lists with extra care. Configuration is read from `~/.pi/agent/plan.json`; document schema changes in `plan/README.md`.
