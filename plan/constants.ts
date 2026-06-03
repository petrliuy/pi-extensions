import type { PhaseName, PlanModeStateName, ApprovalTransition } from './types.js';

export const PLAN_PROPOSAL_TOOL = 'propose_plan';
export const PLAN_TASK_UPDATE_TOOL = 'plan_task_update';
export const PLAN_STATE_SCHEMA_VERSION = 2;
export const NORMAL_MODE_TOOLS = ['read', 'bash', 'edit', 'write'];
export const PLAN_MODE_TOOLS = [...NORMAL_MODE_TOOLS, 'grep', 'find', 'ls', 'questionnaire', PLAN_PROPOSAL_TOOL];
export const EXECUTE_MODE_TOOLS = [...NORMAL_MODE_TOOLS, PLAN_TASK_UPDATE_TOOL];
export const PLAN_MODE_WRITE_TOOLS = new Set(['edit', 'write', 'apply_patch']);
export const APPROVAL_CHOICES = ['Execute plan', 'Refine planning', 'Edit plan'] as const;
export const FORMAT_REPAIR_CHOICES = ['Refine the plan', 'Stay in plan mode', 'Exit plan mode'] as const;
export const MAX_AUTO_CONTINUATIONS = 8;
export const MAX_NO_PROGRESS_CONTINUATIONS = 2;

export const PLAN_PROPOSAL_PARAMETERS = {
	type: 'object',
	properties: {
		title: {
			type: 'string',
			description: 'Short title for the proposed plan.',
		},
		summary: {
			type: 'string',
			description:
				'Brief summary of what the plan will accomplish, including key code findings, constraints, and implementation judgment that execution should preserve.',
		},
		steps: {
			type: 'array',
			minItems: 1,
			items: { type: 'string' },
			description: 'Ordered implementation steps. Each item becomes one tracked todo.',
		},
		verification: {
			type: 'array',
			items: { type: 'string' },
			description: 'Optional verification commands or scenarios.',
		},
		assumptions: {
			type: 'array',
			items: { type: 'string' },
			description: 'Explicit defaults or assumptions used when planning without asking.',
		},
		risks: {
			type: 'array',
			items: { type: 'string' },
			description: 'Optional risk notes to display with the plan.',
		},
		files: {
			type: 'array',
			items: { type: 'string' },
			description: 'Optional likely touched files or modules for display only.',
		},
	},
	required: ['title', 'summary', 'steps'],
	additionalProperties: false,
} as const;

export const PLAN_TASK_UPDATE_PARAMETERS = {
	type: 'object',
	properties: {
		taskId: {
			type: 'string',
			description: 'Task id from the approved plan, e.g. task-1.',
		},
		status: {
			type: 'string',
			enum: ['pending', 'in_progress', 'completed', 'blocked'],
			description: 'New task status.',
		},
		message: {
			type: 'string',
			description: 'Optional short progress or blocker note.',
		},
	},
	required: ['taskId', 'status'],
	additionalProperties: false,
} as const;

export function phaseForMode(mode: PlanModeStateName): PhaseName {
	if (mode === 'executing') return 'execute';
	if (mode === 'normal') return 'normal';
	return 'plan';
}

export function isPlanModeActive(mode: PlanModeStateName): boolean {
	return mode !== 'normal' && mode !== 'executing';
}

export function transitionApproval(choice: string | undefined): ApprovalTransition {
	if (choice === 'Execute plan') {
		return { mode: 'executing', effect: 'start_execution' };
	}
	if (choice === 'Refine planning') {
		return { mode: 'refining', effect: 'open_refinement' };
	}
	if (choice === 'Edit plan') {
		return { mode: 'approval', effect: 'open_editor' };
	}
	return { mode: 'planning', effect: 'dismiss_approval' };
}
