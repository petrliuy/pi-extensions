import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const MAX_GOAL_LENGTH = 4000;

type GoalStatus = "pursuing" | "paused" | "achieved" | "unmet";

interface GoalState {
	objective: string;
	status: GoalStatus;
	updatedAt: string;
}

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function now(): string {
	return new Date().toISOString();
}

function parseGoalStatus(text: string): GoalStatus | undefined {
	const match = text.match(/\[GOAL:(achieved|unmet)\]/i);
	return match?.[1]?.toLowerCase() as GoalStatus | undefined;
}

export default function goalExtension(pi: ExtensionAPI): void {
	let currentGoal: GoalState | undefined;

	function persistState(): void {
		pi.appendEntry("goal-mode", {
			goal: currentGoal ?? null,
		});
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!currentGoal) {
			ctx.ui.setStatus("goal-mode", undefined);
			ctx.ui.setWidget("goal-widget", undefined);
			return;
		}

		const label = `goal ${currentGoal.status}`;
		const themedLabel =
			currentGoal.status === "pursuing"
				? ctx.ui.theme.fg("accent", label)
				: currentGoal.status === "paused"
					? ctx.ui.theme.fg("warning", label)
					: currentGoal.status === "achieved"
						? ctx.ui.theme.fg("success", label)
						: ctx.ui.theme.fg("warning", label);

		ctx.ui.setStatus("goal-mode", themedLabel);
		ctx.ui.setWidget("goal-widget", [
			`${ctx.ui.theme.fg("muted", "Goal:")} ${truncate(currentGoal.objective, 120)}`,
			`${ctx.ui.theme.fg("muted", "Status:")} ${currentGoal.status}`,
		]);
	}

	function showGoal(ctx: ExtensionContext): void {
		if (!currentGoal) {
			ctx.ui.notify("No active goal. Set one with /goal <objective>.", "info");
			return;
		}

		ctx.ui.notify(
			`Goal (${currentGoal.status}):\n${currentGoal.objective}\n\nUpdated: ${currentGoal.updatedAt}`,
			"info",
		);
	}

	pi.registerCommand("goal", {
		description: "Set, pause, resume, view, or clear a persistent task goal",
		handler: async (args, ctx) => {
			const input = args.trim();
			const command = input.toLowerCase();

			if (!input) {
				showGoal(ctx);
				return;
			}

			if (command === "pause") {
				if (!currentGoal) {
					ctx.ui.notify("No active goal to pause.", "warning");
					return;
				}
				currentGoal = { ...currentGoal, status: "paused", updatedAt: now() };
				updateStatus(ctx);
				persistState();
				ctx.ui.notify("Goal paused.", "info");
				return;
			}

			if (command === "resume") {
				if (!currentGoal) {
					ctx.ui.notify("No active goal to resume.", "warning");
					return;
				}
				currentGoal = { ...currentGoal, status: "pursuing", updatedAt: now() };
				updateStatus(ctx);
				persistState();
				ctx.ui.notify("Goal resumed.", "info");
				pi.sendUserMessage(`Resume pursuing the active goal: ${currentGoal.objective}`);
				return;
			}

			if (command === "clear") {
				currentGoal = undefined;
				updateStatus(ctx);
				persistState();
				ctx.ui.notify("Goal cleared.", "info");
				return;
			}

			if (input.length > MAX_GOAL_LENGTH) {
				ctx.ui.notify(`Goal objective must be at most ${MAX_GOAL_LENGTH} characters.`, "error");
				return;
			}

			currentGoal = {
				objective: input,
				status: "pursuing",
				updatedAt: now(),
			};
			updateStatus(ctx);
			persistState();
			ctx.ui.notify("Goal set.", "info");
			pi.sendUserMessage(`Pursue this goal until it is verifiably complete: ${input}`);
		},
	});

	pi.on("context", async (event) => {
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "goal-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[GOAL MODE]");
				}
				if (Array.isArray(content)) {
					return !content.some((c) => {
						const text = c.type === "text" ? (c as TextContent).text : undefined;
						return text?.includes("[GOAL MODE]");
					});
				}
				return true;
			}),
		};
	});

	pi.on("before_agent_start", async () => {
		if (!currentGoal) return;

		if (currentGoal.status === "paused") {
			return {
				message: {
					customType: "goal-context",
					content: `[GOAL MODE]
An active goal is paused:
${currentGoal.objective}

Do not pursue this goal unless the user explicitly asks or resumes it with /goal resume.`,
					display: false,
				},
			};
		}

		if (currentGoal.status !== "pursuing") return;

		return {
			message: {
				customType: "goal-context",
				content: `[GOAL MODE]
You are pursuing a durable task goal attached to this session:
${currentGoal.objective}

Goal workflow:
1. Keep this objective in mind across turns until it is achieved, explicitly blocked, or cleared.
2. Inspect the relevant repository state before changing behavior.
3. Make focused progress toward the goal using the smallest safe changes.
4. Verify with the smallest practical validation loop before declaring the goal achieved.
5. If verification cannot be run, explain why and provide the fastest practical manual verification.
6. If the goal is achieved, include [GOAL:achieved] in the final response and state the verification evidence.
7. If the goal cannot be achieved, include [GOAL:unmet] and explain the concrete blocker.

Do not mark the goal achieved before implementation and verification are complete.`,
				display: false,
			},
		};
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!currentGoal || currentGoal.status !== "pursuing") return;
		if (!isAssistantMessage(event.message)) return;

		const status = parseGoalStatus(getTextContent(event.message));
		if (!status) return;

		currentGoal = { ...currentGoal, status, updatedAt: now() };
		updateStatus(ctx);
		persistState();
	});

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const goalEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "goal-mode")
			.pop() as { data?: { goal?: GoalState | null } } | undefined;

		if (goalEntry?.data) {
			currentGoal = goalEntry.data.goal ?? undefined;
		}

		updateStatus(ctx);
	});
}
