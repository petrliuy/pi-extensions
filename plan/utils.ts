/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

interface ShellToken {
	text: string;
	operator: boolean;
}

const COMMAND_SEPARATORS = new Set([";", "&&", "||", "|", "("]);
const COMMAND_PREFIXES = new Set(["command", "env", "time", "nice", "nohup"]);
const WRITE_COMMANDS = new Set([
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
	"dd",
	"shred",
	"sudo",
	"su",
	"kill",
	"pkill",
	"killall",
	"reboot",
	"shutdown",
	"vim",
	"vi",
	"nano",
	"emacs",
	"code",
	"subl",
]);
const PACKAGE_WRITE_COMMANDS = new Set(["install", "uninstall", "update", "ci", "link", "publish", "add", "remove"]);
const GIT_WRITE_COMMANDS = new Set([
	"add",
	"commit",
	"push",
	"pull",
	"merge",
	"rebase",
	"reset",
	"checkout",
	"stash",
	"cherry-pick",
	"revert",
	"tag",
	"init",
	"clone",
]);

function tokenizeShell(command: string): ShellToken[] {
	const tokens: ShellToken[] = [];
	let text = "";
	let quote: "'" | '"' | undefined;

	function pushText(): void {
		if (text.length > 0) {
			tokens.push({ text, operator: false });
			text = "";
		}
	}

	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			if (char === "\\") {
				text += command[i + 1] ?? "";
				i++;
			} else if (char === quote) {
				quote = undefined;
			} else {
				text += char;
			}
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (char === "\\") {
			text += command[i + 1] ?? "";
			i++;
			continue;
		}
		if (/\s/.test(char)) {
			pushText();
			continue;
		}
		const pair = command.slice(i, i + 2);
		if (pair === "&&" || pair === "||" || pair === ">>") {
			pushText();
			tokens.push({ text: pair, operator: true });
			i++;
			continue;
		}
		if (";|<>()>".includes(char)) {
			pushText();
			tokens.push({ text: char, operator: true });
			continue;
		}
		text += char;
	}
	pushText();
	return tokens;
}

function isAssignment(token: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function nextWord(tokens: ShellToken[], start: number): { index: number; text: string } | undefined {
	for (let i = start; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.operator) return undefined;
		if (token.text.length > 0) return { index: i, text: token.text };
	}
	return undefined;
}

function nextSubcommand(tokens: ShellToken[], start: number, optionsWithValue: Set<string>): { index: number; text: string } | undefined {
	for (let i = start; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.operator) return undefined;
		const text = token.text;
		if (text.startsWith("-")) {
			if (optionsWithValue.has(text)) i++;
			continue;
		}
		return { index: i, text };
	}
	return undefined;
}

function hasShellEval(tokens: ShellToken[], commandIndex: number): boolean {
	const command = tokens[commandIndex].text.toLowerCase();
	if (!["bash", "sh", "zsh"].includes(command)) return false;
	for (let i = commandIndex + 1; i < tokens.length && !tokens[i].operator; i++) {
		if (/^-[A-Za-z]*c[A-Za-z]*$/.test(tokens[i].text)) {
			const script = nextWord(tokens, i + 1);
			return script ? isSideEffectCommand(script.text) : true;
		}
	}
	return false;
}

function isCommandSideEffect(tokens: ShellToken[], commandIndex: number): boolean {
	const command = tokens[commandIndex].text.toLowerCase();
	if (WRITE_COMMANDS.has(command)) return true;
	if (command === "git") {
		const subcommand = nextSubcommand(tokens, commandIndex + 1, new Set(["-C", "-c", "--git-dir", "--work-tree"]))?.text.toLowerCase();
		if (!subcommand) return false;
		if (subcommand === "branch") {
			return tokens.slice(commandIndex + 1).some((token) => !token.operator && /^-[A-Za-z]*[dD]/.test(token.text));
		}
		if (subcommand === "stash") {
			const stashAction = nextSubcommand(tokens, commandIndex + 2, new Set())?.text.toLowerCase();
			return stashAction ? !["list", "show"].includes(stashAction) : true;
		}
		return GIT_WRITE_COMMANDS.has(subcommand);
	}
	if (["npm", "yarn", "pnpm", "pip", "brew"].includes(command)) {
		const subcommand = nextSubcommand(tokens, commandIndex + 1, new Set(["--prefix", "--cwd", "-C"]))?.text.toLowerCase();
		return subcommand ? PACKAGE_WRITE_COMMANDS.has(subcommand) : false;
	}
	if (command === "apt" || command === "apt-get") {
		const subcommand = nextSubcommand(tokens, commandIndex + 1, new Set())?.text.toLowerCase();
		return subcommand ? ["install", "remove", "purge", "update", "upgrade"].includes(subcommand) : false;
	}
	if (command === "systemctl") {
		const subcommand = nextSubcommand(tokens, commandIndex + 1, new Set())?.text.toLowerCase();
		return subcommand ? ["start", "stop", "restart", "enable", "disable"].includes(subcommand) : false;
	}
	if (command === "service") {
		const action = nextWord(tokens, commandIndex + 2)?.text.toLowerCase();
		return action ? ["start", "stop", "restart"].includes(action) : false;
	}
	if (command === "sed") {
		return tokens.slice(commandIndex + 1).some((token) => !token.operator && (/^-[A-Za-z]*i/.test(token.text) || token.text === "--in-place"));
	}
	if (command === "perl") {
		return tokens.slice(commandIndex + 1).some((token) => !token.operator && /^-[A-Za-z]*p[A-Za-z]*i/.test(token.text));
	}
	if (command === "find") {
		return tokens.slice(commandIndex + 1).some((token) => !token.operator && token.text === "-delete");
	}
	return hasShellEval(tokens, commandIndex);
}

export function isSideEffectCommand(command: string): boolean {
	const tokens = tokenizeShell(command);
	if (tokens.some((token) => token.operator && (token.text === ">" || token.text === ">>"))) return true;

	let expectsCommand = true;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.operator) {
			expectsCommand = COMMAND_SEPARATORS.has(token.text);
			continue;
		}
		if (!expectsCommand) continue;
		if (isAssignment(token.text) || COMMAND_PREFIXES.has(token.text.toLowerCase())) continue;
		if (isCommandSideEffect(tokens, i)) return true;
		expectsCommand = false;
	}
	return false;
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

export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
		.replace(/`([^`]+)`/g, "$1") // Remove code
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	const proposedPlanMatch = message.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i);
	const planSection = proposedPlanMatch?.[1] ?? extractLegacyPlanSection(message);
	if (!planSection) return items;

	const stepPattern = /^\s*(?:\d+[.)]|[-*]\s+\[[ xX]\])\s+(.+)$/gm;
	for (const match of planSection.matchAll(stepPattern)) {
		const text = match[1].trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				const step = items.length + 1;
				items.push({ id: `legacy-${step}`, step, text: cleaned, completed: false, status: "pending", source: "plan" });
			}
		}
	}
	return items;
}

function extractLegacyPlanSection(message: string): string | undefined {
	const lines = message.split("\n");
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		const normalized = lines[i]
			.trim()
			.replace(/^#{1,6}\s*/, "")
			.replace(/^\*{1,2}|\*{1,2}$/g, "")
			.replace(/:$/, "")
			.trim()
			.toLowerCase();
		if (["plan", "implementation plan", "execution plan", "plan steps", "implementation steps", "steps"].includes(normalized)) {
			start = i + 1;
			break;
		}
	}
	if (start < 0) return undefined;

	const section: string[] = [];
	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		const header = trimmed.replace(/^#{1,6}\s*/, "").replace(/^\*{1,2}|\*{1,2}$/g, "").replace(/:$/, "").trim().toLowerCase();
		if (
			section.length > 0 &&
			(trimmed.startsWith("#") || ["assumptions", "risks", "verification", "files", "notes"].includes(header))
		) {
			break;
		}
		section.push(line);
	}
	return section.join("\n");
}

export function extractDoneSteps(message: string): number[] {
	const steps: number[] = [];
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	let completed = 0;
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item && !item.completed) {
			item.completed = true;
			item.status = "completed";
			completed++;
		}
	}
	return completed;
}
