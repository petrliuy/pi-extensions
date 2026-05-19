/**
 * Plan Mode Extension with Phase Profiles
 *
 * Adds deterministic phase routing on top of the existing plan mode:
 * - plan phase: read-only tools + optional high-reasoning model/provider
 * - execute phase: full tools + optional cheaper/faster model/provider
 * - session restore: reapplies the active phase profile
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

const CONFIG_PATH = join(homedir(), ".pi", "agent", "plan.json");

type PhaseName = "plan" | "execute" | "normal";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface PhaseProfile {
	provider?: string;
	model?: string;
	thinking?: ThinkingLevel;
	tools?: string[];
	context?: string;
}

interface PhaseProfilesConfig {
	profiles?: Partial<Record<PhaseName, PhaseProfile>>;
}

const DEFAULT_PROFILES: Record<PhaseName, PhaseProfile> = {
	plan: {
		thinking: "high",
		tools: PLAN_MODE_TOOLS,
		context: "Use stronger reasoning. Focus on analysis, risks, trade-offs, and an executable plan. Do not edit files.",
	},
	execute: {
		thinking: "medium",
		tools: NORMAL_MODE_TOOLS,
		context: "Use implementation-focused reasoning. Prefer minimal diffs and complete the approved plan step by step.",
	},
	normal: {
		thinking: "medium",
		tools: NORMAL_MODE_TOOLS,
	},
};

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function readConfig(): PhaseProfilesConfig {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as PhaseProfilesConfig;
	} catch {
		return {};
	}
}

function getProfile(config: PhaseProfilesConfig, phase: PhaseName): PhaseProfile {
	return {
		...DEFAULT_PROFILES[phase],
		...(config.profiles?.[phase] ?? {}),
	};
}

function getModelRegistry(ctx: ExtensionContext): { find?: (provider: string, model: string) => unknown } | undefined {
	return (ctx as unknown as { modelRegistry?: { find?: (provider: string, model: string) => unknown } }).modelRegistry;
}

async function applyPhaseProfile(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: PhaseProfilesConfig,
	phase: PhaseName,
): Promise<void> {
	const profile = getProfile(config, phase);

	if (profile.tools?.length) {
		pi.setActiveTools(profile.tools);
	}

	if (profile.thinking) {
		(pi as unknown as { setThinkingLevel?: (level: ThinkingLevel) => void }).setThinkingLevel?.(profile.thinking);
	}

	if (profile.provider && profile.model) {
		const model = getModelRegistry(ctx)?.find?.(profile.provider, profile.model);
		if (!model) {
			ctx.ui.notify(`Phase ${phase}: model not found: ${profile.provider}/${profile.model}`, "warning");
			return;
		}

		const ok = await (pi as unknown as { setModel?: (model: unknown) => Promise<boolean> }).setModel?.(model);
		if (ok === false) {
			ctx.ui.notify(`Phase ${phase}: failed to switch model: ${profile.provider}/${profile.model}`, "warning");
		}
	}
}

export default function planModeExtension(pi: ExtensionAPI): void {
	const config = readConfig();
	let planModeEnabled = false;
	let executionMode = false;
	let activePhase: PhaseName = "normal";
	let todoItems: TodoItem[] = [];

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		const phaseProfile = getProfile(config, activePhase);
		const modelLabel = phaseProfile.provider && phaseProfile.model ? ` ${phaseProfile.provider}/${phaseProfile.model}` : "";
		const thinkingLabel = phaseProfile.thinking ? ` ${phaseProfile.thinking}` : "";

		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}${modelLabel}${thinkingLabel}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", `⏸ plan${modelLabel}${thinkingLabel}`));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text));
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	async function enterPhase(ctx: ExtensionContext, phase: PhaseName): Promise<void> {
		activePhase = phase;
		await applyPhaseProfile(pi, ctx, config, phase);
		updateStatus(ctx);
	}

	async function togglePlanMode(ctx: ExtensionContext): Promise<void> {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];

		if (planModeEnabled) {
			await enterPhase(ctx, "plan");
			ctx.ui.notify(`Plan mode enabled. Tools: ${(getProfile(config, "plan").tools ?? PLAN_MODE_TOOLS).join(", ")}`);
		} else {
			await enterPhase(ctx, "normal");
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		persistState();
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			phase: activePhase,
		});
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.alt("i"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context" || msg.customType === "phase-profile-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]") && !content.includes("[PHASE PROFILE]");
				}
				if (Array.isArray(content)) {
					return !content.some((c) => {
						const text = c.type === "text" ? (c as TextContent).text : undefined;
						return text?.includes("[PLAN MODE ACTIVE]") || text?.includes("[PHASE PROFILE]");
					});
				}
				return true;
			}),
		};
	});

	pi.on("before_agent_start", async () => {
		const profile = getProfile(config, activePhase);
		const phaseContext = profile.context ? `\n\n[PHASE PROFILE: ${activePhase}]\n${profile.context}` : "";

		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: ${(profile.tools ?? PLAN_MODE_TOOLS).join(", ")}
- You CANNOT use: edit, write (file modifications are disabled)
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.${phaseContext}`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.${phaseContext}`,
					display: false,
				},
			};
		}
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	pi.on("agent_end", async (event, ctx) => {
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				await enterPhase(ctx, "normal");
				persistState();
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		if (todoItems.length > 0) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			pi.sendMessage(
				{
					customType: "plan-todo-list",
					content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}

		const choice = await ctx.ui.select("Plan mode - what next?", [
			todoItems.length > 0 ? "Execute the plan (track progress)" : "Execute the plan",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			planModeEnabled = false;
			executionMode = todoItems.length > 0;
			await enterPhase(ctx, "execute");
			persistState();

			const execMessage =
				todoItems.length > 0 ? `Execute the plan. Start with: ${todoItems[0].text}` : "Execute the plan you just created.";
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ triggerTurn: true },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendUserMessage(refinement.trim());
			}
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
			activePhase = "plan";
		}

		const entries = ctx.sessionManager.getEntries();

		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean; phase?: PhaseName } } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			activePhase = planModeEntry.data.phase ?? (planModeEnabled ? "plan" : executionMode ? "execute" : "normal");
		}

		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		await enterPhase(ctx, activePhase);
	});
}
