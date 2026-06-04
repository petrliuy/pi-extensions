/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

export interface CommandAllowlist {
	exact?: string[];
	prefixes?: string[];
}

const BUILT_IN_ALLOW_EXACT = new Set([
	"pwd",
	"ls",
	"git status",
	"git branch --show-current",
	"node --version",
	"node -v",
	"python --version",
	"python -V",
	"python3 --version",
	"python3 -V",
]);

const BUILT_IN_ALLOW_PREFIXES = [
	"cd",
	"rg",
	"grep",
	"find",
	"ls",
	"cat",
	"head",
	"tail",
	"sed -n",
	"awk",
	"jq",
	"fd",
	"wc",
	"sort",
	"uniq",
	"diff",
	"file",
	"stat",
	"git status",
	"git log",
	"git diff",
	"git show",
	"npm list",
	"npm ls",
	"npm view",
	"npm info",
	"npm outdated",
	"npm audit",
	"yarn list",
	"yarn info",
	"pnpm list",
	"pnpm view",
	"pnpm info",
];

/** Common commands with side effects — always rejected in Plan Mode with no approval path. */
const DESTRUCTIVE_COMMAND_PREFIXES = [
	"rm",
	"rmdir",
	"mv",
	"cp",
	"mkdir",
	"touch",
	"chmod",
	"chown",
	"chgrp",
	"ln",
	"tee",
	"truncate",
	"install",
	"curl",
	"wget",
	"ssh",
	"scp",
	"rsync",
	"docker",
	"kill",
	"pkill",
	"killall",
	"apt",
	"apt-get",
	"yum",
	"dnf",
	"brew",
	"snap",
	"pip install",
	"pip3 install",
	"pipx install",
	"uv pip install",
	"cargo install",
	"go install",
	"gem install",
	"npm install",
	"npm i ",
	"npm ci",
	"npm uninstall",
	"npm publish",
	"npm run",
	"npm start",
	"npm restart",
	"npm stop",
	"yarn add",
	"yarn install",
	"yarn remove",
	"yarn run",
	"pnpm add",
	"pnpm install",
	"pnpm remove",
	"pnpm run",
	"bun install",
	"bun add",
	"bun remove",
	"bun run",
	"npx",
	"bunx",
	"uvx",
	"git push",
	"git pull",
	"git merge",
	"git rebase",
	"git reset",
	"git checkout",
	"git switch",
	"git stash",
	"git cherry-pick",
	"git revert",
	"git commit",
	"git tag",
	"git clean",
	"git worktree",
	"git am",
	"git apply",
	"git bisect",
	"make",
	"cmake",
	"gradle",
	"mvn",
	"cargo",
	"go run",
	"go build",
	"python ",
	"python3 ",
	"node ",
	"node -e",
	"bun ",
	"ts-node",
	"tsx ",
	"jest",
	"vitest",
	"pytest",
	"mvn",
	"gradle",
	"terraform",
	"kubectl",
	"helm",
	"ansible",
];

export function isDestructiveCommand(command: string): boolean {
	const normalized = normalizeCommand(command);
	return DESTRUCTIVE_COMMAND_PREFIXES.some((prefix) => {
		return normalized === prefix || normalized.startsWith(`${prefix} `);
	});
}

const UNSAFE_SHELL_PATTERN = /(?:[<>`()]|\$\()/;

function normalizeCommand(command: string): string {
	return command.trim().replace(/\s+/g, " ");
}

function stripHarmlessRedirection(command: string): string {
	return command.replace(/\s+2>>?\s*\/dev\/null\b/g, "");
}

function splitCommandSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let i = 0;

	while (i < command.length) {
		const ch = command[i];

		// Track quoting — content inside quotes is never a delimiter
		if (ch === "'") {
			// Single-quoted: no escaping inside, consume until closing '
			current += ch;
			i++;
			while (i < command.length && command[i] !== "'") {
				current += command[i];
				i++;
			}
			if (i < command.length) {
				current += command[i]; // closing quote
				i++;
			}
			continue;
		}

		if (ch === '"') {
			// Double-quoted: backslash-escaped quotes only
			current += ch;
			i++;
			while (i < command.length && command[i] !== '"') {
				if (command[i] === "\\" && i + 1 < command.length) {
					current += command[i] + command[i + 1];
					i += 2;
				} else {
					current += command[i];
					i++;
				}
			}
			if (i < command.length) {
				current += command[i]; // closing quote
				i++;
			}
			continue;
		}

		// Outside quotes — check for shell delimiters
		const two = command.slice(i, i + 2);

		if (two === "&&" || two === "||") {
			if (current.trim()) segments.push(current.trim());
			current = "";
			i += 2;
			// consume leading whitespace after delimiter
			while (i < command.length && command[i] === " ") i++;
			continue;
		}

		if (ch === "|" || ch === ";") {
			if (current.trim()) segments.push(current.trim());
			current = "";
			i++;
			while (i < command.length && command[i] === " ") i++;
			continue;
		}

		current += ch;
		i++;
	}

	if (current.trim()) segments.push(current.trim());
	return segments;
}

function hasAllowedPrefix(command: string, prefix: string): boolean {
	return command === prefix || command.startsWith(`${prefix} `);
}

function isAllowedSegment(command: string, allowlist: CommandAllowlist): boolean {
	if (BUILT_IN_ALLOW_EXACT.has(command) || allowlist.exact?.includes(command)) return true;

	return [...BUILT_IN_ALLOW_PREFIXES, ...(allowlist.prefixes ?? [])].some((prefix) =>
		hasAllowedPrefix(command, normalizeCommand(prefix)),
	);
}

export function isReadOnlyCommand(command: string, allowlist: CommandAllowlist = {}): boolean {
	const normalized = normalizeCommand(stripHarmlessRedirection(command));
	if (!normalized || UNSAFE_SHELL_PATTERN.test(normalized)) return false;

	const segments = splitCommandSegments(normalized);
	return segments.length > 0 && segments.every((segment) => isAllowedSegment(segment, allowlist));
}

export interface TodoItem {
	id: string;
	step: number;
	text: string;
	completed: boolean;
	status: "pending" | "in_progress" | "completed" | "blocked";
	message?: string;
	source?: "plan";
}
