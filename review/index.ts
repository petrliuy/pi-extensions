import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const REVIEW_TOOLS = ["read", "bash", "grep", "find", "ls"];

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\btee\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bkill\b/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
];

function isSafeCommand(command: string): boolean {
	return !DESTRUCTIVE_PATTERNS.some((p) => p.test(command)) && SAFE_PATTERNS.some((p) => p.test(command));
}

interface PendingReview {
	target: string;
	previousTools?: string[];
	previousThinking?: ThinkingLevel;
}

export default function reviewExtension(pi: ExtensionAPI): void {
	let pendingReview: PendingReview | undefined;

	pi.registerCommand("review", {
		description: "Review code or current working tree changes",
		handler: async (args, ctx) => {
			const target = args.trim() || "the current working tree changes";
			const previousTools = (pi as unknown as { getActiveTools?: () => string[] }).getActiveTools?.();
			const previousThinking = (pi as unknown as { getThinkingLevel?: () => ThinkingLevel }).getThinkingLevel?.();
			pendingReview = { target, previousTools, previousThinking };
			pi.setActiveTools(REVIEW_TOOLS);
			(pi as unknown as { setThinkingLevel?: (level: ThinkingLevel) => void }).setThinkingLevel?.("high");
			ctx.ui.notify(`Review mode enabled for ${target}. Tools: ${REVIEW_TOOLS.join(", ")}. Thinking: high`, "info");
			pi.sendUserMessage(`Review ${target}.`);
		},
	});

	pi.on("tool_call", async (event) => {
		if (!pendingReview || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Review mode: command blocked (not allowlisted).\nCommand: ${command}`,
			};
		}
	});

	pi.on("context", async (event) => {
		let latestReviewContext: unknown;
		if (pendingReview) {
			for (let i = event.messages.length - 1; i >= 0; i--) {
				const msg = event.messages[i] as AgentMessage & { customType?: string };
				if (msg.customType === "review-context") {
					latestReviewContext = event.messages[i];
					break;
				}
			}
		}

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "review-context") return pendingReview !== undefined && m === latestReviewContext;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[REVIEW MODE]");
				}
				if (Array.isArray(content)) {
					return !content.some((c) => {
						const text = c.type === "text" ? (c as TextContent).text : undefined;
						return text?.includes("[REVIEW MODE]");
					});
				}
				return true;
			}),
		};
	});

	pi.on("before_agent_start", async () => {
		if (!pendingReview) return;

		return {
			message: {
				customType: "review-context",
				content: `[REVIEW MODE]
You are performing a focused code review for: ${pendingReview.target}

Restrictions:
- Use only read-only inspection. Do not edit files or change external state.
- Prefer read, grep, find, ls, and read-only bash commands such as git diff, git status, git log, rg, and npm list.

Review workflow:
1. Inspect the relevant diff, files, and surrounding context before concluding.
2. Prioritize correctness, regressions, security, data loss, API/contract mismatches, race conditions, and missing verification.
3. Treat schema or contract mismatches as real issues rather than adding broad compatibility fallbacks.
4. Do not report purely stylistic issues unless they create concrete maintainability or correctness risk.

Response format:
- If issues are found, list them by severity with file paths and concise rationale.
- If no blocking issues are found, say so explicitly and mention any residual risks.
- Include the minimal verification you performed or recommend.
`,
				display: false,
			},
		};
	});

	pi.on("agent_end", async () => {
		if (!pendingReview) return;

		if (pendingReview.previousTools !== undefined) {
			pi.setActiveTools(pendingReview.previousTools);
		}
		if (pendingReview.previousThinking !== undefined) {
			(pi as unknown as { setThinkingLevel?: (level: ThinkingLevel) => void }).setThinkingLevel?.(pendingReview.previousThinking);
		}
		pendingReview = undefined;
	});
}
