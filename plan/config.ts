import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type {
	ConfigDiagnostic,
	PhaseName,
	PhaseProfile,
	PhaseProfilesConfig,
	RuntimeSnapshot,
} from './types.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PLAN_MODE_TOOLS, EXECUTE_MODE_TOOLS, PLAN_PROPOSAL_TOOL, PLAN_TASK_UPDATE_TOOL } from './constants.js';
import { isPlanModeWriteTool } from './guards.js';

const CONFIG_PATH = join(homedir(), '.pi', 'agent', 'plan.json');

export const DEFAULT_PROFILES: Record<PhaseName, PhaseProfile> = {
	plan: {
		thinking: 'high',
		tools: PLAN_MODE_TOOLS,
		context:
			'Use stronger reasoning. Focus on analysis, risks, trade-offs, and an executable proposal. Call propose_plan instead of attempting edits or asking the user to exit Plan Mode.',
		instructions: [],
		planCommandAllow: {
			exact: [],
			prefixes: [],
		},
	},
	execute: {
		thinking: 'medium',
		tools: EXECUTE_MODE_TOOLS,
		context:
			'Use implementation-focused reasoning. Prefer minimal diffs and complete the approved plan step by step.',
	},
	normal: {},
};

export function readConfig(): { config: PhaseProfilesConfig; diagnostics: ConfigDiagnostic[] } {
	if (!existsSync(CONFIG_PATH)) return { config: {}, diagnostics: [] };
	try {
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { config: {}, diagnostics: [{ message: `${CONFIG_PATH}: root must be an object.` }] };
		}
		return { config: parsed as PhaseProfilesConfig, diagnostics: validateConfig(parsed as PhaseProfilesConfig) };
	} catch (error) {
		return {
			config: {},
			diagnostics: [{ message: `${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}` }],
		};
	}
}

function validateConfig(config: PhaseProfilesConfig): ConfigDiagnostic[] {
	const diagnostics: ConfigDiagnostic[] = [];
	const thinkingLevels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
	if (config.profiles !== undefined && (!config.profiles || typeof config.profiles !== 'object' || Array.isArray(config.profiles))) {
		return [{ message: `${CONFIG_PATH}: profiles must be an object.` }];
	}
	for (const phase of ['plan', 'execute', 'normal'] as const) {
		const profile = config.profiles?.[phase];
		if (profile === undefined) continue;
		if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
			diagnostics.push({ message: `${CONFIG_PATH}: profiles.${phase} must be an object.` });
			continue;
		}
		if (profile.tools !== undefined && (!Array.isArray(profile.tools) || profile.tools.some((tool) => typeof tool !== 'string'))) {
			diagnostics.push({ message: `${CONFIG_PATH}: profiles.${phase}.tools must be an array of strings.` });
			delete profile.tools;
		}
		if (profile.instructions !== undefined && (!Array.isArray(profile.instructions) || profile.instructions.some((item) => typeof item !== 'string'))) {
			diagnostics.push({ message: `${CONFIG_PATH}: profiles.${phase}.instructions must be an array of strings.` });
			delete profile.instructions;
		}
		for (const field of ['provider', 'model', 'context'] as const) {
			if (profile[field] !== undefined && typeof profile[field] !== 'string') {
				diagnostics.push({ message: `${CONFIG_PATH}: profiles.${phase}.${field} must be a string.` });
				delete profile[field];
			}
		}
		if (profile.thinking !== undefined && !thinkingLevels.has(profile.thinking)) {
			diagnostics.push({ message: `${CONFIG_PATH}: profiles.${phase}.thinking is invalid.` });
			delete profile.thinking;
		}
		if (profile.planCommandAllow !== undefined) {
			const allow = profile.planCommandAllow;
			const valid =
				allow &&
				typeof allow === 'object' &&
				!Array.isArray(allow) &&
				(allow.exact === undefined ||
					(Array.isArray(allow.exact) && allow.exact.every((item) => typeof item === 'string'))) &&
				(allow.prefixes === undefined ||
					(Array.isArray(allow.prefixes) && allow.prefixes.every((item) => typeof item === 'string')));
			if (!valid) {
				diagnostics.push({ message: `${CONFIG_PATH}: profiles.${phase}.planCommandAllow is invalid.` });
				delete profile.planCommandAllow;
			}
		}
	}
	return diagnostics;
}

export function getProfile(config: PhaseProfilesConfig, phase: PhaseName): PhaseProfile {
	return {
		...DEFAULT_PROFILES[phase],
		...(config.profiles?.[phase] ?? {}),
	};
}

export function getPlanModeTools(profile: PhaseProfile): string[] {
	const requestedTools = profile.tools ?? PLAN_MODE_TOOLS;
	const tools = requestedTools.filter((tool) => !isPlanModeWriteTool(tool));
	if (!tools.includes(PLAN_PROPOSAL_TOOL)) {
		tools.push(PLAN_PROPOSAL_TOOL);
	}
	return tools;
}

export function getExecuteModeTools(profile: PhaseProfile): string[] | undefined {
	if (!profile.tools?.length) return undefined;
	return profile.tools.includes(PLAN_TASK_UPDATE_TOOL) ? profile.tools : [...profile.tools, PLAN_TASK_UPDATE_TOOL];
}

export function captureRuntimeSnapshot(pi: ExtensionAPI, ctx: ExtensionContext): RuntimeSnapshot {
	const model = ctx.model as unknown as { provider?: string; id?: string };
	return {
		provider: model?.provider,
		model: model?.id,
		thinking: pi.getThinkingLevel(),
		tools: pi.getActiveTools(),
	};
}

function getModelRegistry(ctx: ExtensionContext): { find?: (provider: string, model: string) => unknown } | undefined {
	return (ctx as unknown as { modelRegistry?: { find?: (provider: string, model: string) => unknown } })
		.modelRegistry;
}

export async function applyPhaseProfile(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: PhaseProfilesConfig,
	phase: PhaseName,
	runtimeSnapshot?: RuntimeSnapshot,
): Promise<Pick<RuntimeSnapshot, 'provider' | 'model'> | undefined> {
	const profile = getProfile(config, phase);
	let appliedModel: Pick<RuntimeSnapshot, 'provider' | 'model'> | undefined;
	const planTools = phase === 'plan' ? getPlanModeTools(profile) : undefined;
	const executeTools =
		phase === 'execute'
			? getExecuteModeTools(
					config.profiles?.execute?.tools?.length
						? profile
						: { ...profile, tools: runtimeSnapshot?.tools ?? profile.tools },
				)
			: undefined;

	if (phase === 'normal') {
		if (runtimeSnapshot) {
			pi.setActiveTools(runtimeSnapshot.tools);
			pi.setThinkingLevel(runtimeSnapshot.thinking);
			appliedModel = await switchModel(pi, ctx, runtimeSnapshot.provider, runtimeSnapshot.model, 'normal runtime');
		}
		const normalOverrides = config.profiles?.normal;
		if (normalOverrides?.tools) pi.setActiveTools(normalOverrides.tools);
		if (normalOverrides?.thinking) pi.setThinkingLevel(normalOverrides.thinking);
		if (normalOverrides?.provider && normalOverrides.model) {
			appliedModel =
				(await switchModel(pi, ctx, normalOverrides.provider, normalOverrides.model, 'phase normal')) ??
				appliedModel;
		}
		return appliedModel;
	}

	if (planTools) {
		pi.setActiveTools(planTools);
	} else if (executeTools) {
		pi.setActiveTools(executeTools);
	} else {
		pi.setActiveTools(profile.tools ?? []);
	}

	if (profile.thinking) pi.setThinkingLevel(profile.thinking);

	if (profile.provider && profile.model) {
		appliedModel = await switchModel(pi, ctx, profile.provider, profile.model, `phase ${phase}`);
	}
	return appliedModel;
}

async function switchModel(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	provider: string | undefined,
	modelId: string | undefined,
	label: string,
): Promise<Pick<RuntimeSnapshot, 'provider' | 'model'> | undefined> {
	if (!provider || !modelId) return undefined;
	const model = getModelRegistry(ctx)?.find?.(provider, modelId);
	if (!model) {
		if (ctx.hasUI) ctx.ui.notify(`${label}: model not found: ${provider}/${modelId}`, 'warning');
		return undefined;
	}
	const ok = await pi.setModel(model as never);
	if (ok === false && ctx.hasUI) {
		ctx.ui.notify(`${label}: failed to switch model: ${provider}/${modelId}`, 'warning');
	}
	return ok === false ? undefined : { provider, model: modelId };
}
