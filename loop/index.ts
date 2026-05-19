import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const TICK_MS = 5000;
const MAX_PROMPT_LENGTH = 4000;
const WIDGET_LIMIT = 5;

type LoopStatus = "active" | "paused";
type LoopRunStatus = "done" | "blocked";
type LoopSchedule = IntervalSchedule | DailySchedule;

interface IntervalSchedule {
	type: "interval";
	intervalMs: number;
}

interface DailySchedule {
	type: "daily";
	hour: number;
	minute: number;
}

interface LoopTask {
	id: string;
	prompt: string;
	schedule?: LoopSchedule;
	intervalMs?: number;
	status: LoopStatus;
	createdAt: string;
	updatedAt: string;
	nextRunAt: string;
	lastRunAt?: string;
	runCount: number;
	lastSummary?: string;
	pending?: boolean;
}

interface LoopStateEntry {
	loops?: LoopTask[];
	nextId?: number;
}

function now(): string {
	return new Date().toISOString();
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
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

function parseRunStatus(text: string, id: string): LoopRunStatus | undefined {
	const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = text.match(new RegExp(`\\[LOOP:${escaped}:(done|blocked)\\]`, "i"));
	return match?.[1]?.toLowerCase() as LoopRunStatus | undefined;
}

function parseClock(hourText: string, minuteText?: string): { hour: number; minute: number } | undefined {
	const hour = Number(hourText);
	const minute = minuteText === undefined || minuteText === "" ? 0 : Number(minuteText);
	if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
	return { hour, minute };
}

function parseNaturalLoop(input: string): { schedule: LoopSchedule; prompt: string } | undefined {
	const trimmed = input.trim();

	let match = trimmed.match(/^每(?:隔)?\s*(\d+(?:\.\d+)?)\s*(分钟|小时)\s*(.+)$/);
	if (match) {
		const amount = Number(match[1]);
		const unit = match[2];
		const prompt = match[3].trim();
		if (Number.isFinite(amount) && amount > 0 && prompt) {
			return {
				schedule: { type: "interval", intervalMs: amount * (unit === "小时" ? 3600000 : 60000) },
				prompt,
			};
		}
	}

	match = trimmed.match(/^每天\s*(\d{1,2})(?:(?:点|[:：])\s*(\d{1,2})?)?\s*(.+)$/);
	if (match) {
		const clock = parseClock(match[1], match[2]);
		const prompt = match[3].trim();
		if (clock && prompt) {
			return {
				schedule: { type: "daily", hour: clock.hour, minute: clock.minute },
				prompt,
			};
		}
	}

	match = trimmed.match(/^(.+?)\s+every\s+(\d+(?:\.\d+)?)\s+(minutes?|hours?)$/i);
	if (match) {
		const prompt = match[1].trim();
		const amount = Number(match[2]);
		const unit = match[3].toLowerCase();
		if (prompt && Number.isFinite(amount) && amount > 0) {
			return {
				schedule: { type: "interval", intervalMs: amount * (unit.startsWith("hour") ? 3600000 : 60000) },
				prompt,
			};
		}
	}

	match = trimmed.match(/^(.+?)\s+every\s+day\s+at\s+(\d{1,2})(?::(\d{1,2}))?$/i);
	if (match) {
		const prompt = match[1].trim();
		const clock = parseClock(match[2], match[3]);
		if (prompt && clock) {
			return {
				schedule: { type: "daily", hour: clock.hour, minute: clock.minute },
				prompt,
			};
		}
	}

	match = trimmed.match(/^(.+?)\s+at\s+(\d{1,2})(?::(\d{1,2}))?\s+every\s+day$/i);
	if (match) {
		const prompt = match[1].trim();
		const clock = parseClock(match[2], match[3]);
		if (prompt && clock) {
			return {
				schedule: { type: "daily", hour: clock.hour, minute: clock.minute },
				prompt,
			};
		}
	}

	return undefined;
}

function formatInterval(ms: number): string {
	const minutes = ms / 60000;
	const hours = ms / 3600000;
	if (Number.isInteger(hours) && hours >= 1) return `${hours}h`;
	if (Number.isInteger(minutes)) return `${minutes}m`;
	return `${minutes.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}m`;
}

function formatClock(hour: number, minute: number): string {
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getSchedule(loop: LoopTask): LoopSchedule {
	return loop.schedule ?? { type: "interval", intervalMs: loop.intervalMs ?? 60000 };
}

function formatSchedule(loop: LoopTask): string {
	const schedule = getSchedule(loop);
	if (schedule.type === "daily") return `daily ${formatClock(schedule.hour, schedule.minute)}`;
	return `every ${formatInterval(schedule.intervalMs)}`;
}

function getNextRunAt(schedule: LoopSchedule, fromMs = Date.now()): string {
	if (schedule.type === "interval") {
		return new Date(fromMs + schedule.intervalMs).toISOString();
	}

	const next = new Date(fromMs);
	next.setHours(schedule.hour, schedule.minute, 0, 0);
	if (next.getTime() <= fromMs) {
		next.setDate(next.getDate() + 1);
	}
	return next.toISOString();
}

function formatDueTime(iso: string): string {
	const deltaMs = new Date(iso).getTime() - Date.now();
	const absMs = Math.abs(deltaMs);
	const minutes = Math.round(absMs / 60000);
	const seconds = Math.round(absMs / 1000);
	const value = minutes >= 1 ? `${minutes}m` : `${seconds}s`;
	return deltaMs <= 0 ? "due" : `in ${value}`;
}

function reschedule(loop: LoopTask, fromMs = Date.now()): LoopTask {
	return {
		...loop,
		nextRunAt: getNextRunAt(getSchedule(loop), fromMs),
		updatedAt: now(),
		pending: false,
	};
}

export default function loopExtension(pi: ExtensionAPI): void {
	let loops: LoopTask[] = [];
	let nextId = 1;
	let timer: ReturnType<typeof setInterval> | undefined;
	let lastCtx: ExtensionContext | undefined;
	let agentRunning = false;
	let runningLoopId: string | undefined;

	function persistState(): void {
		pi.appendEntry("loop-mode", {
			loops,
			nextId,
		});
	}

	function updateStatus(ctx: ExtensionContext): void {
		const active = loops.filter((loop) => loop.status === "active").length;
		const paused = loops.filter((loop) => loop.status === "paused").length;

		if (active === 0 && paused === 0) {
			ctx.ui.setStatus("loop-mode", undefined);
			ctx.ui.setWidget("loop-widget", undefined);
			return;
		}

		const label = paused > 0 ? `loop ${active} active / ${paused} paused` : `loop ${active} active`;
		ctx.ui.setStatus("loop-mode", ctx.ui.theme.fg(active > 0 ? "accent" : "warning", label));

		const visible = [...loops]
			.sort((a, b) => {
				if (a.status !== b.status) return a.status === "active" ? -1 : 1;
				return new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime();
			})
			.slice(0, WIDGET_LIMIT);

		ctx.ui.setWidget(
			"loop-widget",
			visible.map((loop) => {
				const marker = loop.status === "active" ? "run" : "pause";
				const next = loop.status === "active" ? formatDueTime(loop.nextRunAt) : "paused";
				return `${ctx.ui.theme.fg("muted", loop.id)} ${marker} ${formatSchedule(loop)} next ${next} count ${loop.runCount}`;
			}),
		);
	}

	function showHelp(ctx: ExtensionContext): void {
		ctx.ui.notify(
			[
				"Loop commands:",
				"/loop <natural language schedule and task>",
				"/loop 每天8点查找我的邮件",
				"/loop check my mail every day at 8",
				"/loop list",
				"/loop status [id]",
				"/loop show <id>",
				"/loop pause <id>",
				"/loop resume <id>",
				"/loop stop <id>",
				"/loop rm <id>",
				"/loop delete <id>",
			].join("\n"),
			"info",
		);
	}

	function findLoop(id: string): LoopTask | undefined {
		return loops.find((loop) => loop.id === id);
	}

	function listLoops(ctx: ExtensionContext): void {
		if (loops.length === 0) {
			ctx.ui.notify("No loops. Create one with /loop <natural language schedule and task>.", "info");
			return;
		}

		const lines = loops.map((loop) => {
			const next = loop.status === "active" ? formatDueTime(loop.nextRunAt) : "paused";
			return `${loop.id} ${loop.status} ${formatSchedule(loop)} next ${next} runs ${loop.runCount}: ${truncate(loop.prompt, 80)}`;
		});
		ctx.ui.notify(`Loops:\n${lines.join("\n")}`, "info");
	}

	function showLoop(ctx: ExtensionContext, id: string): void {
		const loop = findLoop(id);
		if (!loop) {
			ctx.ui.notify(`Loop not found: ${id}`, "warning");
			return;
		}

		ctx.ui.notify(
			[
				`Loop ${loop.id}`,
				`Status: ${loop.status}`,
				`Schedule: ${formatSchedule(loop)}`,
				`Runs: ${loop.runCount}`,
				`Next: ${loop.status === "active" ? formatDueTime(loop.nextRunAt) : "paused"}`,
				`Created: ${loop.createdAt}`,
				`Updated: ${loop.updatedAt}`,
				"",
				"Prompt:",
				loop.prompt,
				loop.lastSummary ? `\nLast summary:\n${loop.lastSummary}` : "",
			]
				.filter(Boolean)
				.join("\n"),
			"info",
		);
	}

	function createLoop(ctx: ExtensionContext, schedule: LoopSchedule, prompt: string): void {
		if (prompt.length > MAX_PROMPT_LENGTH) {
			ctx.ui.notify(`Loop prompt must be at most ${MAX_PROMPT_LENGTH} characters.`, "error");
			return;
		}

		const id = `l${nextId++}`;
		const createdAt = now();
		const loop: LoopTask = {
			id,
			prompt,
			schedule,
			intervalMs: schedule.type === "interval" ? schedule.intervalMs : undefined,
			status: "active",
			createdAt,
			updatedAt: createdAt,
			nextRunAt: getNextRunAt(schedule),
			runCount: 0,
		};
		loops = [...loops, loop];
		updateStatus(ctx);
		persistState();
		ctx.ui.notify(`Loop ${id} started. Schedule: ${formatSchedule(loop)}.`, "info");
		ensureScheduler();
	}

	function setLoopStatus(ctx: ExtensionContext, id: string, status: LoopStatus): void {
		const loop = findLoop(id);
		if (!loop) {
			ctx.ui.notify(`Loop not found: ${id}`, "warning");
			return;
		}

		loops = loops.map((item) => {
			if (item.id !== id) return item;
			if (status === "active") return reschedule({ ...item, status });
			return { ...item, status, updatedAt: now(), pending: false };
		});
		updateStatus(ctx);
		persistState();
		ctx.ui.notify(`Loop ${id} ${status === "active" ? "resumed" : "paused"}.`, "info");
		ensureScheduler();
	}

	function stopLoop(ctx: ExtensionContext, id: string): void {
		if (!findLoop(id)) {
			ctx.ui.notify(`Loop not found: ${id}`, "warning");
			return;
		}

		loops = loops.filter((loop) => loop.id !== id);
		if (runningLoopId === id) runningLoopId = undefined;
		updateStatus(ctx);
		persistState();
		ctx.ui.notify(`Loop ${id} stopped.`, "info");
	}

	function nextDueLoop(): LoopTask | undefined {
		const nowMs = Date.now();
		return loops
			.filter((loop) => loop.status === "active" && (loop.pending || new Date(loop.nextRunAt).getTime() <= nowMs))
			.sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())[0];
	}

	function markDueLoopsPending(): void {
		const nowMs = Date.now();
		let changed = false;
		loops = loops.map((loop) => {
			if (loop.status !== "active" || loop.pending || new Date(loop.nextRunAt).getTime() > nowMs) return loop;
			changed = true;
			return { ...loop, pending: true, updatedAt: now() };
		});
		if (changed) persistState();
	}

	function triggerDueLoop(): void {
		if (!lastCtx || agentRunning || runningLoopId) {
			markDueLoopsPending();
			if (lastCtx) updateStatus(lastCtx);
			return;
		}

		const loop = nextDueLoop();
		if (!loop) return;

		runningLoopId = loop.id;
		loops = loops.map((item) => {
			if (item.id !== loop.id) return item;
			return {
				...item,
				pending: false,
				lastRunAt: now(),
				updatedAt: now(),
				runCount: item.runCount + 1,
				nextRunAt: getNextRunAt(getSchedule(item)),
			};
		});
		updateStatus(lastCtx);
		persistState();

		pi.sendUserMessage(`[LOOP RUN ${loop.id}]
Run this scheduled loop task.

Loop id: ${loop.id}
Schedule: ${formatSchedule(loop)}
Task:
${loop.prompt}

Complete this run once, then stop. In your final response include [LOOP:${loop.id}:done] if the task ran successfully, or [LOOP:${loop.id}:blocked] with the concrete blocker.`);
	}

	function ensureScheduler(): void {
		if (timer) return;
		timer = setInterval(() => triggerDueLoop(), TICK_MS);
	}

	pi.registerCommand("loop", {
		description: "Create, list, pause, resume, or stop scheduled loop tasks",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const input = args.trim();
			if (!input || input === "help") {
				showHelp(ctx);
				return;
			}

			const [command = "", id = ""] = input.split(/\s+/, 2);
			switch (command.toLowerCase()) {
				case "list":
					listLoops(ctx);
					return;
				case "status":
					if (id) showLoop(ctx, id);
					else listLoops(ctx);
					return;
				case "show":
					if (!id) ctx.ui.notify("Usage: /loop show <id>", "warning");
					else showLoop(ctx, id);
					return;
				case "pause":
					if (!id) ctx.ui.notify("Usage: /loop pause <id>", "warning");
					else setLoopStatus(ctx, id, "paused");
					return;
				case "resume":
					if (!id) ctx.ui.notify("Usage: /loop resume <id>", "warning");
					else setLoopStatus(ctx, id, "active");
					return;
				case "stop":
					if (!id) ctx.ui.notify("Usage: /loop stop <id>", "warning");
					else stopLoop(ctx, id);
					return;
				case "rm":
					if (!id) ctx.ui.notify("Usage: /loop rm <id>", "warning");
					else stopLoop(ctx, id);
					return;
				case "delete":
					if (!id) ctx.ui.notify("Usage: /loop delete <id>", "warning");
					else stopLoop(ctx, id);
					return;
				default:
					break;
			}

			const natural = parseNaturalLoop(input);
			if (natural) {
				createLoop(ctx, natural.schedule, natural.prompt);
				return;
			}

			ctx.ui.notify(
				"Could not parse loop schedule. Use a concrete time or interval, e.g. /loop 每天8点查找我的邮件 or /loop check mail every 5 minutes.",
				"warning",
			);
		},
	});

	pi.on("before_agent_start", async () => {
		agentRunning = true;
	});

	pi.on("agent_end", async (event, ctx) => {
		lastCtx = ctx;
		agentRunning = false;

		if (runningLoopId) {
			const loopId = runningLoopId;
			runningLoopId = undefined;
			const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
			if (lastAssistant) {
				const text = getTextContent(lastAssistant);
				const status = parseRunStatus(text, loopId);
				const summary = status ? text.replace(/\[LOOP:[^\]]+\]/gi, "").trim() : text.trim();
				loops = loops.map((loop) =>
					loop.id === loopId
						? {
								...loop,
								lastSummary: truncate(summary, 500),
								updatedAt: now(),
							}
						: loop,
				);
				persistState();
			}
		}

		updateStatus(ctx);
		triggerDueLoop();
	});

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		const entries = ctx.sessionManager.getEntries();
		const loopEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "loop-mode")
			.pop() as { data?: LoopStateEntry } | undefined;

		if (loopEntry?.data) {
			loops = loopEntry.data.loops ?? [];
			nextId = loopEntry.data.nextId ?? nextId;
		}

		updateStatus(ctx);
		ensureScheduler();
		triggerDueLoop();
	});
}
