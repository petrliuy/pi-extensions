import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@mariozechner/pi-coding-agent";
import { visibleWidth, type EditorTheme, type TUI } from "@mariozechner/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
	PERSONA_STATES,
	SPECIES_IDS,
	SPECIES_TABLE,
	type BuddyPersonaState,
	type BuddySpecies,
	type BuddySpeciesId,
} from "./species.js";

const BUDDY_PATH = join(homedir(), ".pi", "agent", "buddy.json");
const STATE_VERSION = 2;
const LEGACY_STATE_VERSION = 1;
const MIN_EDITOR_WIDTH = 32;
const MAX_BUDDY_PANEL_WIDTH = 20;
const BUDDY_PANEL_GAP = 2;
const BUDDY_RIGHT_PADDING = 2;
const ANIMATION_INTERVAL_MS = 200;
const ONE_SHOT_DURATION_MS = 3600;

type BuddyRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
type LegacyBuddyMood = "curious" | "focused" | "pleased" | "sleepy";

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
	species: BuddySpeciesId;
	rarity: BuddyRarity;
	personality: string;
	level: number;
	xp: number;
	pets: number;
	personaState: BuddyPersonaState;
	oneShotState?: BuddyPersonaState;
	oneShotUntil?: string;
	muted: boolean;
	visible: boolean;
	stats: BuddyStats;
	createdAt: string;
	updatedAt: string;
	lastSpeech: string;
}

interface LegacyBuddyState {
	version: typeof LEGACY_STATE_VERSION;
	name: string;
	species: string;
	rarity: BuddyRarity;
	personality: string;
	level: number;
	xp: number;
	pets: number;
	mood: LegacyBuddyMood;
	muted: boolean;
	visible: boolean;
	stats: BuddyStats;
	createdAt: string;
	updatedAt: string;
	lastSpeech: string;
}

type UiTheme = ExtensionContext["ui"]["theme"];

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
	{ rarity: "rare", weight: 75, statBonus: 2 },
	{ rarity: "epic", weight: 22, statBonus: 3 },
	{ rarity: "legendary", weight: 3, statBonus: 4 },
];

const RARITY_VALUES = new Set<BuddyRarity>(RARITIES.map((item) => item.rarity));
const LEGACY_RARITY_VALUES = new Set<BuddyRarity>(["common", "uncommon"]);
const LEGACY_MOOD_VALUES = new Set<LegacyBuddyMood>(["curious", "focused", "pleased", "sleepy"]);
const PERSONA_STATE_VALUES = new Set<BuddyPersonaState>(PERSONA_STATES);
const SPECIES_VALUES = new Set<BuddySpeciesId>(SPECIES_IDS);

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

function hatchBuddy(): BuddyState {
	const rarity = pickRarity();
	const createdAt = now();
	const xp = 0;
	return {
		version: STATE_VERSION,
		name: pick(NAMES),
		species: pick(SPECIES_TABLE).id,
		rarity: rarity.rarity,
		personality: pick(PERSONALITIES),
		level: getLevel(xp),
		xp,
		pets: 0,
		personaState: "idle",
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

function hasStats(value: Partial<BuddyState> | Partial<LegacyBuddyState>): boolean {
	const stats = value.stats as Partial<BuddyStats> | undefined;
	return (
		typeof stats?.debugging === "number" &&
		typeof stats?.patience === "number" &&
		typeof stats?.chaos === "number" &&
		typeof stats?.wisdom === "number" &&
		typeof stats?.snark === "number"
	);
}

function isLegacyBuddyState(value: unknown): value is LegacyBuddyState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<LegacyBuddyState>;
	const rarity = state.rarity as BuddyRarity;
	return (
		state.version === LEGACY_STATE_VERSION &&
		typeof state.name === "string" &&
		typeof state.species === "string" &&
		typeof state.rarity === "string" &&
		(RARITY_VALUES.has(rarity) || LEGACY_RARITY_VALUES.has(rarity)) &&
		typeof state.personality === "string" &&
		typeof state.level === "number" &&
		typeof state.xp === "number" &&
		typeof state.pets === "number" &&
		typeof state.mood === "string" &&
		LEGACY_MOOD_VALUES.has(state.mood as LegacyBuddyMood) &&
		typeof state.muted === "boolean" &&
		typeof state.visible === "boolean" &&
		typeof state.createdAt === "string" &&
		typeof state.updatedAt === "string" &&
		typeof state.lastSpeech === "string" &&
		hasStats(state)
	);
}

function isBuddyState(value: unknown): value is BuddyState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<BuddyState>;
	const rarity = state.rarity as BuddyRarity;
	return (
		state.version === STATE_VERSION &&
		typeof state.name === "string" &&
		typeof state.species === "string" &&
		SPECIES_VALUES.has(state.species as BuddySpeciesId) &&
		typeof state.rarity === "string" &&
		RARITY_VALUES.has(rarity) &&
		typeof state.personality === "string" &&
		typeof state.level === "number" &&
		typeof state.xp === "number" &&
		typeof state.pets === "number" &&
		typeof state.personaState === "string" &&
		PERSONA_STATE_VALUES.has(state.personaState as BuddyPersonaState) &&
		(state.oneShotState === undefined || PERSONA_STATE_VALUES.has(state.oneShotState)) &&
		(state.oneShotUntil === undefined || typeof state.oneShotUntil === "string") &&
		typeof state.muted === "boolean" &&
		typeof state.visible === "boolean" &&
		typeof state.createdAt === "string" &&
		typeof state.updatedAt === "string" &&
		typeof state.lastSpeech === "string" &&
		hasStats(state)
	);
}

function normalizeRarity(rarity: BuddyRarity): BuddyRarity {
	if (rarity === "common" || rarity === "uncommon") return "rare";
	return rarity;
}

function normalizeSpecies(species: string): BuddySpeciesId {
	const normalized = species.trim().toLowerCase() as BuddySpeciesId;
	return SPECIES_VALUES.has(normalized) ? normalized : "mushroom";
}

function migrateMood(mood: LegacyBuddyMood): BuddyPersonaState {
	if (mood === "focused") return "busy";
	if (mood === "pleased") return "heart";
	if (mood === "sleepy") return "sleep";
	return "idle";
}

function migrateLegacyBuddyState(state: LegacyBuddyState): BuddyState {
	return {
		version: STATE_VERSION,
		name: state.name,
		species: normalizeSpecies(state.species),
		rarity: normalizeRarity(state.rarity),
		personality: state.personality,
		level: state.level,
		xp: state.xp,
		pets: state.pets,
		personaState: migrateMood(state.mood),
		muted: state.muted,
		visible: state.visible,
		stats: state.stats,
		createdAt: state.createdAt,
		updatedAt: now(),
		lastSpeech: state.lastSpeech,
	};
}

function readBuddyState(): BuddyState | undefined {
	if (!existsSync(BUDDY_PATH)) return undefined;
	const parsed = JSON.parse(readFileSync(BUDDY_PATH, "utf8")) as unknown;
	if (isBuddyState(parsed)) return parsed;
	if (isLegacyBuddyState(parsed)) return migrateLegacyBuddyState(parsed);
	throw new Error(`Invalid buddy state schema in ${BUDDY_PATH}`);
}

function writeBuddyState(state: BuddyState): void {
	mkdirSync(dirname(BUDDY_PATH), { recursive: true });
	writeFileSync(BUDDY_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function padRight(value: string, width: number): string {
	return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
}

function trimBlankOuterLines(lines: string[]): string[] {
	const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
	if (firstContentLine === -1) return [];

	let lastContentLine = lines.length - 1;
	while (lastContentLine > firstContentLine && lines[lastContentLine]?.trim().length === 0) {
		lastContentLine -= 1;
	}

	return lines.slice(firstContentLine, lastContentLine + 1);
}

function getSpecies(speciesId: BuddySpeciesId): BuddySpecies {
	return SPECIES_TABLE.find((species) => species.id === speciesId) ?? SPECIES_TABLE[0];
}

function getSpeciesIndex(speciesId: BuddySpeciesId): number {
	return Math.max(0, SPECIES_TABLE.findIndex((species) => species.id === speciesId));
}

function getActivePersonaState(state: BuddyState): BuddyPersonaState {
	if (state.oneShotState && state.oneShotUntil && Date.parse(state.oneShotUntil) > Date.now()) {
		return state.oneShotState;
	}
	return state.personaState;
}

function triggerOneShot(state: BuddyState, personaState: BuddyPersonaState): void {
	state.oneShotState = personaState;
	state.oneShotUntil = new Date(Date.now() + ONE_SHOT_DURATION_MS).toISOString();
}

function setPersonaState(state: BuddyState, personaState: BuddyPersonaState): void {
	state.personaState = personaState;
	state.oneShotState = undefined;
	state.oneShotUntil = undefined;
}

function formatArt(state: BuddyState, frameIndex: number): string[] {
	const species = getSpecies(state.species);
	const animation = species.states[getActivePersonaState(state)];
	const sequenceIndex = Math.floor(frameIndex / animation.beatDivisor) % animation.sequence.length;
	const poseIndex = animation.sequence[sequenceIndex] ?? 0;
	return animation.poses[poseIndex] ?? animation.poses[0];
}

function getPanelWidth(lines: string[]): number {
	const artWidth = Math.max(...lines.map((line) => visibleWidth(line)));
	return Math.min(MAX_BUDDY_PANEL_WIDTH, artWidth + BUDDY_RIGHT_PADDING);
}

function getArtColor(theme: UiTheme, state: BuddyState): (value: string) => string {
	if (state.rarity === "legendary") return (value) => theme.fg("warning", value);
	if (state.rarity === "epic") return (value) => theme.fg("accent", value);
	if (state.rarity === "rare") return (value) => theme.fg("success", value);
	return (value) => theme.fg("muted", value);
}

function formatEditorPanel(theme: UiTheme, state: BuddyState, frameIndex: number): string[] {
	const color = getArtColor(theme, state);
	return trimBlankOuterLines(formatArt(state, frameIndex)).map((line) => color(line));
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
		const editorTopPadding = Math.max(0, lineCount - editorLines.length);
		const lines: string[] = [];

		for (let index = 0; index < lineCount; index += 1) {
			const editorLine = index >= editorTopPadding ? editorLines[index - editorTopPadding] : "";
			lines.push(`${padRight(editorLine ?? "", editorWidth)}${" ".repeat(BUDDY_PANEL_GAP)}${panelLines[index] ?? ""}`);
		}

		return lines;
	}
}

function formatCard(state: BuddyState): string {
	const species = getSpecies(state.species);
	return [
		`${state.name} the ${state.rarity} ${species.name}`,
		`Personality: ${state.personality}`,
		`Level: ${state.level}`,
		`XP: ${state.xp}`,
		`State: ${getActivePersonaState(state)}`,
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
		`State file: ${BUDDY_PATH}`,
	].join("\n");
}

function formatSpeciesList(): string {
	return SPECIES_TABLE.map((species) => species.id).join(", ");
}

function showHelp(ctx: ExtensionContext): void {
	ctx.ui.notify(
		[
			"Buddy commands:",
			"/buddy",
			"/buddy card",
			"/buddy pet",
			"/buddy idle",
			"/buddy sleep",
			"/buddy busy",
			"/buddy attention",
			"/buddy celebrate",
			"/buddy dizzy",
			"/buddy heart",
			"/buddy next",
			"/buddy species",
			"/buddy species <name>",
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
			const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const command = parts[0] ?? "";

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
				const previousLevel = state.level;
				const xpGain = 12 + Math.floor(Math.random() * 9);
				state.pets += 1;
				state.xp += xpGain;
				state.level = getLevel(state.xp);
				triggerOneShot(state, state.level > previousLevel ? "celebrate" : "heart");
				state.lastSpeech = pick(PET_SPEECH);
				state.visible = true;
				state.updatedAt = now();
				if (!persistState(ctx)) return;
				updateStatus(ctx);
				return;
			}

			if (PERSONA_STATE_VALUES.has(command as BuddyPersonaState)) {
				const state = ensureBuddy(ctx);
				if (!state) return;
				setPersonaState(state, command as BuddyPersonaState);
				state.visible = true;
				state.updatedAt = now();
				if (!persistState(ctx)) return;
				updateStatus(ctx);
				return;
			}

			if (command === "next") {
				const state = ensureBuddy(ctx);
				if (!state) return;
				const nextIndex = (getSpeciesIndex(state.species) + 1) % SPECIES_TABLE.length;
				state.species = SPECIES_TABLE[nextIndex].id;
				setPersonaState(state, "idle");
				state.visible = true;
				state.updatedAt = now();
				if (!persistState(ctx)) return;
				updateStatus(ctx);
				return;
			}

			if (command === "species") {
				const state = ensureBuddy(ctx);
				if (!state) return;
				const speciesName = parts[1];
				if (!speciesName) {
					ctx.ui.notify(`Species: ${formatSpeciesList()}`, "info");
					updateStatus(ctx);
					return;
				}
				const speciesId = speciesName as BuddySpeciesId;
				if (!SPECIES_VALUES.has(speciesId)) {
					ctx.ui.notify(`Unknown species: ${speciesName}\nSpecies: ${formatSpeciesList()}`, "warning");
					return;
				}
				state.species = speciesId;
				setPersonaState(state, "idle");
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
				ctx.ui.notify("Usage: /buddy [card|pet|idle|sleep|busy|attention|celebrate|dizzy|heart|next|species|mute|unmute|off|help]", "warning");
				return;
			}

			const state = ensureBuddy(ctx);
			if (!state) return;
			state.visible = true;
			setPersonaState(state, "idle");
			state.updatedAt = now();
			if (!persistState(ctx)) return;
			updateStatus(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		installBuddyEditor(ctx);

		try {
			buddy = readBuddyState();
			if (buddy) {
				writeBuddyState(buddy);
			}
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
