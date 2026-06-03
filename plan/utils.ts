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

const UNSAFE_SHELL_PATTERN = /(?:[<>`()]|\$\()/;

function normalizeCommand(command: string): string {
	return command.trim().replace(/\s+/g, " ");
}

function stripHarmlessRedirection(command: string): string {
	return command.replace(/\s+2>>?\s*\/dev\/null\b/g, "");
}

function splitCommandSegments(command: string): string[] {
	return command
		.split(/\s*(?:&&|\|\||[|;])\s*/g)
		.map((segment) => segment.trim())
		.filter(Boolean);
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
	source?: "plan" | "blocked_command";
	command?: string;
}
