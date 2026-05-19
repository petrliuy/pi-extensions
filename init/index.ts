import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type InitKind = "codex" | "claude";
type ClaudeMode = "docs" | "local" | "project" | "all";

interface InitRequest {
	kind: InitKind;
	claudeMode?: ClaudeMode;
}

function parseInitArgs(args: string): InitRequest | "help" | undefined {
	const tokens = args
		.trim()
		.toLowerCase()
		.split(/[\s/]+/)
		.filter(Boolean);

	if (tokens.length === 0) return { kind: "codex" };
	if (tokens.includes("help") || tokens.includes("-h") || tokens.includes("--help")) return "help";

	const [kind, mode] = tokens;
	if (kind === "codex") return { kind: "codex" };
	if (kind !== "claude") return undefined;

	switch (mode) {
		case undefined:
		case "docs":
		case "doc":
			return { kind: "claude", claudeMode: "docs" };
		case "local":
			return { kind: "claude", claudeMode: "local" };
		case "project":
		case "dir":
			return { kind: "claude", claudeMode: "project" };
		case "all":
			return { kind: "claude", claudeMode: "all" };
		default:
			return undefined;
	}
}

function showHelp(ctx: ExtensionContext): void {
	ctx.ui.notify(
		[
			"Init commands:",
			"/init",
			"/init codex",
			"/init claude",
			"/init claude local",
			"/init claude project",
			"/init claude all",
			"",
			"Default is Codex-style AGENTS.md. Claude local/project modes also update .gitignore for local-only files.",
		].join("\n"),
		"info",
	);
}

function buildCodexPrompt(): string {
	return `[INIT CODEX]
Initialize persistent Codex project instructions for the current project.

Goal:
- Create or update AGENTS.md in the current directory.

Workflow:
1. Inspect the project structure, existing instruction files, README files, package/build files, test setup, and git status before editing.
2. If AGENTS.md already exists, preserve existing project-specific guidance and make the smallest useful update.
3. If AGENTS.md is missing, create a concise repository guide with practical instructions for future coding agents.
4. Include only verified commands, paths, conventions, and constraints. State when a command or test setup cannot be verified.
5. Touch only AGENTS.md unless a directly necessary local repository convention requires otherwise.

Content expectations:
- Project structure and module organization.
- Build, test, and development commands that actually exist.
- Coding style and naming conventions visible in the repository.
- Testing and verification guidance.
- Commit or PR guidance only if it can be inferred from local evidence.
- Security or configuration notes when relevant.

Finish with a concise summary of touched files and the minimal verification performed.`;
}

function buildClaudePrompt(mode: ClaudeMode): string {
	const includeLocal = mode === "local" || mode === "all";
	const includeProjectDir = mode === "project" || mode === "all";
	const gitignoreEntries = [
		includeLocal ? "CLAUDE.local.md" : undefined,
		includeProjectDir ? ".claude/settings.local.json" : undefined,
		includeProjectDir ? ".claude/worktrees/" : undefined,
	].filter((entry): entry is string => entry !== undefined);

	const targets = ["CLAUDE.md"];
	if (includeLocal) targets.push("CLAUDE.local.md");
	if (includeProjectDir) {
		targets.push(".claude/settings.json");
		targets.push(".claude/settings.local.json");
		targets.push(".claude/CLAUDE.md");
		targets.push(".claude/rules/");
		targets.push(".claude/agents/");
		targets.push(".claude/skills/");
		targets.push(".claude/worktrees/");
	}

	const gitignoreText =
		gitignoreEntries.length > 0
			? `\nGitignore requirements:\n- Ensure these local-only entries exist in .gitignore: ${gitignoreEntries.join(", ")}.`
			: "";

	return `[INIT CLAUDE]
Initialize Claude Code project instructions for the current project.

Goal:
- Create or update only these targets as needed: ${targets.join(", ")}.${gitignoreText}

Workflow:
1. Inspect the project structure, existing instruction files, README files, package/build files, test setup, .gitignore, and git status before editing.
2. If CLAUDE.md or .claude/CLAUDE.md already exists, preserve existing project-specific guidance and make the smallest useful update.
3. If a target file is missing, create a concise, practical scaffold based on verified repository facts.
4. Do not invent commands, paths, tools, policies, agents, skills, or settings that cannot be verified from the repository.
5. Keep shared files team-safe. Put personal preferences only in CLAUDE.local.md or .claude/settings.local.json when those files are part of this mode.
6. Touch only the requested Claude targets and the required .gitignore entries.

Content expectations:
- CLAUDE.md: shared project instructions for Claude Code.
- CLAUDE.local.md: personal project preferences, if requested.
- .claude/settings.json: minimal valid shared project settings object, if requested.
- .claude/settings.local.json: minimal valid local settings object, if requested.
- .claude/CLAUDE.md: equivalent project-level Claude instructions or a short pointer to ../CLAUDE.md, if requested.
- .claude/rules/, .claude/agents/, .claude/skills/, .claude/worktrees/: create empty directories with small placeholder README files only when needed to make the directory intentional and visible to git.

Finish with a concise summary of touched files and the minimal verification performed.`;
}

function buildPrompt(request: InitRequest): string {
	if (request.kind === "codex") return buildCodexPrompt();
	return buildClaudePrompt(request.claudeMode ?? "docs");
}

export default function initExtension(pi: ExtensionAPI): void {
	pi.registerCommand("init", {
		description: "Initialize Codex or Claude project instruction files",
		handler: async (args, ctx) => {
			const request = parseInitArgs(args);

			if (request === "help") {
				showHelp(ctx);
				return;
			}

			if (!request) {
				ctx.ui.notify("Usage: /init [codex|claude [local|project|all]]. Run /init help for examples.", "warning");
				return;
			}

			const label = request.kind === "codex" ? "Codex AGENTS.md" : `Claude ${request.claudeMode ?? "docs"}`;
			ctx.ui.notify(`Init started for ${label}.`, "info");
			pi.sendUserMessage(buildPrompt(request));
		},
	});
}
