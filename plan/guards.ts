import type { ToolGuardDecision } from './types.js';
import type { CommandAllowlist } from './utils.js';
import { isReadOnlyCommand, isDestructiveCommand } from './utils.js';
import { PLAN_MODE_WRITE_TOOLS } from './constants.js';

export function isPlanModeWriteTool(toolName: string): boolean {
	const normalized = toolName.toLowerCase();
	const shortName = normalized.split('.').pop() ?? normalized;
	return PLAN_MODE_WRITE_TOOLS.has(normalized) || PLAN_MODE_WRITE_TOOLS.has(shortName);
}

function planInstructionGuard(prefix: string): string {
	return `${prefix} Continue with read-only inspection and call propose_plan for the requested change when the approach is clear. Do not ask the user to exit or switch Plan Mode. Add only recurring read-only commands to profiles.plan.planCommandAllow.`;
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

export function shellPlanGuard(command: string, allowlist: CommandAllowlist = {}): ToolGuardDecision | undefined {
	if (isReadOnlyCommand(command, allowlist)) return undefined;

	if (isDestructiveCommand(command)) {
		return {
			block: true,
			reason: planInstructionGuard(
				`Plan mode: this command has side effects and cannot run in Plan Mode.\nCommand: ${command}`,
			),
		};
	}

	return {
		block: true,
		reason: planInstructionGuard(
			`Plan mode: bash command is not in the read-only allowlist.\nCommand: ${command}`,
		),
	};
}
