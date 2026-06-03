import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { PhaseName, PhaseProfile, PhaseProfilesConfig, ThinkingLevel } from './types.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PLAN_MODE_TOOLS, EXECUTE_MODE_TOOLS, PLAN_PROPOSAL_TOOL, PLAN_TASK_UPDATE_TOOL } from './constants.js';

const CONFIG_PATH = join(homedir(), '.pi', 'agent', 'plan.json');

export const DEFAULT_PROFILES: Record<PhaseName, PhaseProfile> = {
	plan: {
		thinking: 'high',
		tools: PLAN_MODE_TOOLS,
		context:
			'Use stronger reasoning. Focus on analysis, risks, trade-offs, and an executable plan. Do not edit files.',
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
	normal: {
		thinking: 'medium',
		tools: ['read', 'bash', 'edit', 'write'],
	},
};

export function readConfig(): PhaseProfilesConfig {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as PhaseProfilesConfig;
	} catch {
		return {};
	}
}

export function getProfile(config: PhaseProfilesConfig, phase: PhaseName): PhaseProfile {
	return {
		...DEFAULT_PROFILES[phase],
		...(config.profiles?.[phase] ?? {}),
	};
}

export function getPlanModeTools(profile: PhaseProfile): string[] {
	const requestedTools = profile.tools ?? PLAN_MODE_TOOLS;
	const tools = [...requestedTools];
	if (!tools.includes(PLAN_PROPOSAL_TOOL)) {
		tools.push(PLAN_PROPOSAL_TOOL);
	}
	return tools;
}

export function getExecuteModeTools(profile: PhaseProfile): string[] | undefined {
	if (!profile.tools?.length) return undefined;
	return profile.tools.includes(PLAN_TASK_UPDATE_TOOL) ? profile.tools : [...profile.tools, PLAN_TASK_UPDATE_TOOL];
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
): Promise<void> {
	const profile = getProfile(config, phase);
	const planTools = phase === 'plan' ? getPlanModeTools(profile) : undefined;
	const executeTools = phase === 'execute' ? getExecuteModeTools(profile) : undefined;

	if (planTools) {
		pi.setActiveTools(planTools);
	} else if (executeTools) {
		pi.setActiveTools(executeTools);
	} else if (profile.tools?.length) {
		pi.setActiveTools(profile.tools);
	}

	if (profile.thinking) {
		(pi as unknown as { setThinkingLevel?: (level: ThinkingLevel) => void }).setThinkingLevel?.(profile.thinking);
	}

	if (profile.provider && profile.model) {
		const model = getModelRegistry(ctx)?.find?.(profile.provider, profile.model);
		if (!model) {
			ctx.ui.notify(`Phase ${phase}: model not found: ${profile.provider}/${profile.model}`, 'warning');
			return;
		}

		const ok = await (pi as unknown as { setModel?: (model: unknown) => Promise<boolean> }).setModel?.(model);
		if (ok === false) {
			ctx.ui.notify(`Phase ${phase}: failed to switch model: ${profile.provider}/${profile.model}`, 'warning');
		}
	}
}
