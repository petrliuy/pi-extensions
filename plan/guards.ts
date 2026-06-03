import type { ToolGuardDecision } from './types.js';
import { isSideEffectCommand } from './utils.js';
import { PLAN_MODE_WRITE_TOOLS } from './constants.js';
import { summarizeCommand } from './format.js';

export function isPlanModeWriteTool(toolName: string): boolean {
	const normalized = toolName.toLowerCase();
	const shortName = normalized.split('.').pop() ?? normalized;
	return PLAN_MODE_WRITE_TOOLS.has(normalized) || PLAN_MODE_WRITE_TOOLS.has(shortName);
}

function planInstructionGuard(prefix: string): string {
	return `${prefix} Stop using write-capable tools or side-effect commands and call propose_plan for the requested change, or ask a critical question with questionnaire. The approval UI will start execution after the plan is approved.`;
}

export function writeToolGuard(toolName: string): ToolGuardDecision | undefined {
	if (!isPlanModeWriteTool(toolName)) return undefined;
	return {
		block: true,
		reason: planInstructionGuard(
			`Plan mode: ${toolName} is disabled. Do not edit files while Plan Mode is active.`,
		),
	};
}

export function shellSideEffectGuard(command: string): ToolGuardDecision | undefined {
	if (!isSideEffectCommand(command)) return undefined;
	return {
		block: true,
		blockedCommand: {
			toolName: 'bash',
			command,
			text: summarizeCommand(command),
		},
		reason: planInstructionGuard(
			`Plan mode: command blocked because it may change files, dependencies, git state, processes, or system state.\nCommand: ${command}`,
		),
	};
}
