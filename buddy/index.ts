import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@mariozechner/pi-coding-agent";
import { visibleWidth, type EditorTheme, type TUI } from "@mariozechner/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const BUDDY_PATH = join(homedir(), ".pi", "agent", "buddy.json");
const STATE_VERSION = 1;
const MIN_EDITOR_WIDTH = 32;
const MIN_BUDDY_PANEL_WIDTH = 11;
const MAX_BUDDY_PANEL_WIDTH = 20;
const BUDDY_PANEL_GAP = 2;
const ANIMATION_INTERVAL_MS = 420;

type BuddyRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
type BuddyMood = "curious" | "focused" | "pleased" | "sleepy";
type BuddyArtSet = Record<BuddyMood, string[][]>;

interface BuddyStats {
	debugging: number;
	patience: number;
	chaos: number;
	wisdom: number;
	snark: number;
}

interface BuddyState {
	version: typeof STATE_VERSION;
	name: string;
	species: string;
	rarity: BuddyRarity;
	personality: string;
	level: number;
	xp: number;
	pets: number;
	mood: BuddyMood;
	muted: boolean;
	visible: boolean;
	stats: BuddyStats;
	createdAt: string;
	updatedAt: string;
	lastSpeech: string;
}

type UiTheme = ExtensionContext["ui"]["theme"];

const SPECIES = [
	"Bitling",
	"Patchsprite",
	"Stackwhisp",
	"Lintling",
	"Nullkin",
	"Branchlet",
	"Diffdrift",
	"Shellspark",
	"Tokenimp",
	"Cachelet",
	"Promptkin",
	"Mergewhisp",
	"Cursorling",
	"Logsprite",
	"Tracekin",
	"Bytebloom",
	"Specsprite",
	"Bugblink",
];

const NAMES = [
	"Nib",
	"Pip",
	"Zed",
	"Moro",
	"Vim",
	"Juno",
	"Kai",
	"Rook",
	"Tess",
	"Nix",
	"Bram",
	"Quill",
	"Dot",
	"Rune",
	"Flux",
	"Miso",
];

const PERSONALITIES = [
	"careful",
	"nosy",
	"dry",
	"patient",
	"restless",
	"literal",
	"quiet",
	"bright",
];

const HATCH_SPEECH = [
	"ready to inspect the edges",
	"watching the status line",
	"freshly compiled and mildly suspicious",
	"keeping one eye on the diff",
	"waiting for the next clean step",
];

const PET_SPEECH = [
	"tiny morale patch applied",
	"attention received",
	"confidence cache warmed",
	"tailwind not required",
	"still watching the diff",
	"acceptable",
];

const RARITIES: Array<{ rarity: BuddyRarity; weight: number; statBonus: number }> = [
	{ rarity: "common", weight: 55, statBonus: 0 },
	{ rarity: "uncommon", weight: 25, statBonus: 1 },
	{ rarity: "rare", weight: 13, statBonus: 2 },
	{ rarity: "epic", weight: 6, statBonus: 3 },
	{ rarity: "legendary", weight: 1, statBonus: 4 },
];

const RARITY_VALUES = new Set<BuddyRarity>(RARITIES.map((item) => item.rarity));
const MOOD_VALUES = new Set<BuddyMood>(["curious", "focused", "pleased", "sleepy"]);

function now(): string {
	return new Date().toISOString();
}

function pick<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)];
}

function pickRarity(): { rarity: BuddyRarity; statBonus: number } {
	const roll = Math.random() * RARITIES.reduce((sum, item) => sum + item.weight, 0);
	let cursor = 0;
	for (const item of RARITIES) {
		cursor += item.weight;
		if (roll <= cursor) return item;
	}
	return RARITIES[0];
}

function rollStat(bonus: number): number {
	return 1 + Math.floor(Math.random() * 6) + bonus;
}

function getLevel(xp: number): number {
	return Math.max(1, Math.floor(xp / 100) + 1);
}

function getMood(pets: number): BuddyMood {
	if (pets === 0) return "curious";
	if (pets % 7 === 0) return "sleepy";
	if (pets % 3 === 0) return "focused";
	return "pleased";
}

function hatchBuddy(): BuddyState {
	const rarity = pickRarity();
	const createdAt = now();
	const xp = 0;
	return {
		version: STATE_VERSION,
		name: pick(NAMES),
		species: pick(SPECIES),
		rarity: rarity.rarity,
		personality: pick(PERSONALITIES),
		level: getLevel(xp),
		xp,
		pets: 0,
		mood: "curious",
		muted: false,
		visible: true,
		stats: {
			debugging: rollStat(rarity.statBonus),
			patience: rollStat(rarity.statBonus),
			chaos: rollStat(rarity.statBonus),
			wisdom: rollStat(rarity.statBonus),
			snark: rollStat(rarity.statBonus),
		},
		createdAt,
		updatedAt: createdAt,
		lastSpeech: pick(HATCH_SPEECH),
	};
}

function isBuddyState(value: unknown): value is BuddyState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<BuddyState>;
	const stats = state.stats as Partial<BuddyStats> | undefined;
	return (
		state.version === STATE_VERSION &&
		typeof state.name === "string" &&
		typeof state.species === "string" &&
		typeof state.rarity === "string" &&
		RARITY_VALUES.has(state.rarity as BuddyRarity) &&
		typeof state.personality === "string" &&
		typeof state.level === "number" &&
		typeof state.xp === "number" &&
		typeof state.pets === "number" &&
		typeof state.mood === "string" &&
		MOOD_VALUES.has(state.mood as BuddyMood) &&
		typeof state.muted === "boolean" &&
		typeof state.visible === "boolean" &&
		typeof state.createdAt === "string" &&
		typeof state.updatedAt === "string" &&
		typeof state.lastSpeech === "string" &&
		typeof stats?.debugging === "number" &&
		typeof stats?.patience === "number" &&
		typeof stats?.chaos === "number" &&
		typeof stats?.wisdom === "number" &&
		typeof stats?.snark === "number"
	);
}

function readBuddyState(): BuddyState | undefined {
	if (!existsSync(BUDDY_PATH)) return undefined;
	const parsed = JSON.parse(readFileSync(BUDDY_PATH, "utf8")) as unknown;
	if (!isBuddyState(parsed)) {
		throw new Error(`Invalid buddy state schema in ${BUDDY_PATH}`);
	}
	return parsed;
}

function writeBuddyState(state: BuddyState): void {
	mkdirSync(dirname(BUDDY_PATH), { recursive: true });
	writeFileSync(BUDDY_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function padRight(value: string, width: number): string {
	return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
}

const ART_SETS: BuddyArtSet[] = [
	{
		curious: [
			[" .---.", "[o_o]", "/|_|\\", " / \\"],
			[" .---.", "[O_o]", "/|_|\\", " / \\"],
			[" .---.", "[o_O]", "/|_|\\", " / \\"],
		],
		focused: [
			[" .---.", "[>_<]", "/|_|\\", " / \\"],
			[" .---.", "[-_-]", "/|_|\\", " / \\"],
		],
		pleased: [
			[" .---.", "[^_^]", "/|_|\\", " / \\"],
			[" .---.", "[^o^]", "\\|_|/", " / \\"],
		],
		sleepy: [
			[" .---.", "[-_-]", "/|_|\\", " / \\"],
			[" .---.", "[-.-]", "/|_|\\", " / \\"],
		],
	},
	{
		curious: [
			[" /^^\\", "(o.o)", "<|_|>", " / \\"],
			[" /^^\\", "(O.o)", "<|_|>", " / \\"],
			[" /^^\\", "(o.O)", "<|_|>", " / \\"],
		],
		focused: [
			[" /^^\\", "(>.<)", "<|_|>", " / \\"],
			[" /^^\\", "(-.-)", "<|_|>", " / \\"],
		],
		pleased: [
			[" /^^\\", "(^.^)", "<|_|>", "_/ \\_"],
			[" /^^\\", "(^o^)", "\\|_|/", "_/ \\_"],
		],
		sleepy: [
			[" /^^\\", "(-.-)", "<|_|>", " / \\"],
			[" /--\\", "(-_-)", "<|_|>", " / \\"],
		],
	},
	{
		curious: [
			["  ___", " /o o\\", "|  ^ |", " \\___/"],
			["  ___", " /O o\\", "|  ^ |", " \\___/"],
			["  ___", " /o O\\", "|  ^ |", " \\___/"],
		],
		focused: [
			["  ___", " /> <\\", "|  - |", " \\___/"],
			["  ___", " /- -\\", "|  - |", " \\___/"],
		],
		pleased: [
			["  ___", " /^ ^\\", "|  v |", " \\___/"],
			["  ___", " /^ o\\", "|  v |", " \\___/"],
		],
		sleepy: [
			["  ___", " /- -\\", "|  . |", " \\___/"],
			["  ___", " /_ _\\", "|  . |", " \\___/"],
		],
	},
	{
		curious: [
			[" .-^-.", "{o_o}", " /|\\ ", " / \\"],
			[" .-^-.", "{O_o}", " /|\\ ", " / \\"],
			[" .-^-.", "{o_O}", " /|\\ ", " / \\"],
		],
		focused: [
			[" .-^-.", "{>_<}", " /|\\ ", " / \\"],
			[" .-^-.", "{-_-}", " /|\\ ", " / \\"],
		],
		pleased: [
			[" .-^-.", "{^_^}", " \\|/ ", " / \\"],
			[" .-^-.", "{^o^}", " \\|/ ", "_/ \\_"],
		],
		sleepy: [
			[" .-^-.", "{-_-}", " /|\\ ", " / \\"],
			[" .---.", "{-.-}", " /|\\ ", " / \\"],
		],
	},
	{
		curious: [
			["  /\\ ", " (oo)", "/|==|", " / \\"],
			["  /\\ ", " (Oo)", "/|==|", " / \\"],
			["  /\\ ", " (oO)", "/|==|", " / \\"],
		],
		focused: [
			["  /\\ ", " (><)", "/|==|", " / \\"],
			["  /\\ ", " (--)", "/|==|", " / \\"],
		],
		pleased: [
			["  /\\ ", " (^^)", "\\|==|", " / \\"],
			["  /\\ ", " (^o)", "\\|==/", "_/ \\"],
		],
		sleepy: [
			["  /\\ ", " (--)", "/|==|", " / \\"],
			["  -- ", " (-.)", "/|==|", " / \\"],
		],
	},
];

function hashText(value: string): number {
	let hash = 0;
	for (const char of value) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	}
	return hash;
}

function pickArtSet(state: BuddyState): BuddyArtSet {
	return ART_SETS[hashText(`${state.name}:${state.species}:${state.rarity}`) % ART_SETS.length];
}

function formatArt(state: BuddyState, frameIndex: number): string[] {
	const frames = pickArtSet(state)[state.mood];
	return frames[frameIndex % frames.length];
}

function getPanelWidth(lines: string[]): number {
	return Math.min(MAX_BUDDY_PANEL_WIDTH, Math.max(MIN_BUDDY_PANEL_WIDTH, ...lines.map((line) => visibleWidth(line))));
}

function getArtColor(theme: UiTheme, state: BuddyState): (value: string) => string {
	if (state.rarity === "legendary" || state.rarity === "epic") return (value) => theme.fg("warning", value);
	if (state.rarity === "rare" || state.rarity === "uncommon") return (value) => theme.fg("accent", value);
	return (value) => theme.fg("muted", value);
}

function formatEditorPanel(theme: UiTheme, state: BuddyState, frameIndex: number): string[] {
	const color = getArtColor(theme, state);
	return formatArt(state, frameIndex).map((line) => color(line));
}

class BuddyEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly getBuddy: () => BuddyState | undefined,
		private readonly getTheme: () => UiTheme | undefined,
		private readonly getFrameIndex: () => number,
	) {
		super(tui, theme, keybindings);
	}

	render(width: number): string[] {
		const state = this.getBuddy();
		const theme = this.getTheme();
		if (!state?.visible || !theme) return super.render(width);

		const panelLines = formatEditorPanel(theme, state, this.getFrameIndex());
		const panelWidth = getPanelWidth(panelLines);
		const editorWidth = width - panelWidth - BUDDY_PANEL_GAP;
		if (editorWidth < MIN_EDITOR_WIDTH) return super.render(width);

		const editorLines = super.render(editorWidth);
		const lineCount = Math.max(editorLines.length, panelLines.length);
		const lines: string[] = [];

		for (let index = 0; index < lineCount; index += 1) {
			lines.push(`${padRight(editorLines[index] ?? "", editorWidth)}${" ".repeat(BUDDY_PANEL_GAP)}${panelLines[index] ?? ""}`);
		}

		return lines;
	}
}

function formatCard(state: BuddyState): string {
	return [
		`${state.name} the ${state.rarity} ${state.species}`,
		`Personality: ${state.personality}`,
		`Level: ${state.level}`,
		`XP: ${state.xp}`,
		`Mood: ${state.mood}`,
		`Pets: ${state.pets}`,
		`Muted: ${state.muted ? "yes" : "no"}`,
		`Visible: ${state.visible ? "yes" : "no"}`,
		"",
		"Stats:",
		`- debugging ${state.stats.debugging}`,
		`- patience ${state.stats.patience}`,
		`- chaos ${state.stats.chaos}`,
		`- wisdom ${state.stats.wisdom}`,
		`- snark ${state.stats.snark}`,
		"",
		`Created: ${state.createdAt}`,
		`Updated: ${state.updatedAt}`,
		`State: ${BUDDY_PATH}`,
	].join("\n");
}

function showHelp(ctx: ExtensionContext): void {
	ctx.ui.notify(
		[
			"Buddy commands:",
			"/buddy",
			"/buddy card",
			"/buddy pet",
			"/buddy mute",
			"/buddy unmute",
			"/buddy off",
			"/buddy help",
		].join("\n"),
		"info",
	);
}

export default function buddyExtension(pi: ExtensionAPI): void {
	let buddy: BuddyState | undefined;
	let loadError: string | undefined;
	let currentTheme: UiTheme | undefined;
	let currentTui: TUI | undefined;
	let animationFrame = 0;
	let animationTimer: ReturnType<typeof setInterval> | undefined;
	let buddyEditorInstalled = false;
	let editorConflictNotified = false;

	function startAnimation(): void {
		if (animationTimer) return;
		animationTimer = setInterval(() => {
			animationFrame += 1;
			if (buddy?.visible) {
				currentTui?.requestRender();
			}
		}, ANIMATION_INTERVAL_MS);
	}

	function stopAnimation(): void {
		if (!animationTimer) return;
		clearInterval(animationTimer);
		animationTimer = undefined;
		currentTui = undefined;
	}

	function installBuddyEditor(ctx: ExtensionContext): void {
		currentTheme = ctx.ui.theme;
		if (buddyEditorInstalled) return;

		if (ctx.ui.getEditorComponent()) {
			if (!editorConflictNotified) {
				ctx.ui.notify("Buddy right-side panel is disabled because another extension owns the editor.", "warning");
				editorConflictNotified = true;
			}
			return;
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			currentTui = tui;
			startAnimation();
			return new BuddyEditor(tui, theme, keybindings, () => buddy, () => currentTheme, () => animationFrame);
		});
		buddyEditorInstalled = true;
	}

	function persistState(ctx: ExtensionContext): boolean {
		if (!buddy) return true;
		if (loadError) {
			ctx.ui.notify(loadError, "error");
			return false;
		}

		try {
			writeBuddyState(buddy);
			return true;
		} catch (error) {
			ctx.ui.notify(`Failed to save buddy state: ${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	}

	function updateStatus(ctx: ExtensionContext): void {
		currentTheme = ctx.ui.theme;
		currentTui?.requestRender();
		ctx.ui.setStatus("buddy-mode", undefined);
		ctx.ui.setWidget("buddy-widget", undefined);
	}

	function ensureBuddy(ctx: ExtensionContext): BuddyState | undefined {
		if (loadError) {
			ctx.ui.notify(loadError, "error");
			return undefined;
		}
		if (!buddy) {
			buddy = hatchBuddy();
			if (!persistState(ctx)) return undefined;
		}
		return buddy;
	}

	pi.registerCommand("buddy", {
		description: "Show, hatch, pet, mute, or hide a local terminal buddy",
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();

			if (command === "help") {
				showHelp(ctx);
				return;
			}

			if (command === "card") {
				const state = ensureBuddy(ctx);
				if (!state) return;
				ctx.ui.notify(formatCard(state), "info");
				updateStatus(ctx);
				return;
			}

			if (command === "pet") {
				const state = ensureBuddy(ctx);
				if (!state) return;
				const xpGain = 12 + Math.floor(Math.random() * 9);
				state.pets += 1;
				state.xp += xpGain;
				state.level = getLevel(state.xp);
				state.mood = getMood(state.pets);
				state.lastSpeech = pick(PET_SPEECH);
				state.visible = true;
				state.updatedAt = now();
				if (!persistState(ctx)) return;
				updateStatus(ctx);
				return;
			}

			if (command === "mute" || command === "unmute") {
				const state = ensureBuddy(ctx);
				if (!state) return;
				state.muted = command === "mute";
				state.visible = true;
				state.updatedAt = now();
				if (!persistState(ctx)) return;
				updateStatus(ctx);
				return;
			}

			if (command === "off") {
				const state = ensureBuddy(ctx);
				if (!state) return;
				state.visible = false;
				state.updatedAt = now();
				if (!persistState(ctx)) return;
				updateStatus(ctx);
				return;
			}

			if (command) {
				ctx.ui.notify("Usage: /buddy [card|pet|mute|unmute|off|help]", "warning");
				return;
			}

			const state = ensureBuddy(ctx);
			if (!state) return;
			state.visible = true;
			state.updatedAt = now();
			if (!persistState(ctx)) return;
			updateStatus(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		installBuddyEditor(ctx);

		try {
			buddy = readBuddyState();
			loadError = undefined;
		} catch (error) {
			buddy = undefined;
			loadError = `Could not load buddy state. Fix or remove ${BUDDY_PATH}. ${error instanceof Error ? error.message : String(error)}`;
			ctx.ui.notify(loadError, "error");
		}

		updateStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		stopAnimation();
	});
}
