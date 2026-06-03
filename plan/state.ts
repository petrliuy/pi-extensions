import type { TodoItem } from './utils.js';
import type { PlanModeStateName, PlanProposal, PendingBlockedCommand } from './types.js';
import { PLAN_STATE_SCHEMA_VERSION } from './constants.js';

export interface PlanModeEntryData {
	schemaVersion?: number;
	mode?: PlanModeStateName;
	enabled: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	phase?: 'plan' | 'execute' | 'normal';
	stage?: 'inspect' | 'plan';
	pendingBlockedCommand?: PendingBlockedCommand;
	pendingPlan?: PlanProposal;
	continuationCount?: number;
	noProgressContinuationCount?: number;
}

export function createPlanState(mode: PlanModeStateName = 'normal') {
	return {
		schemaVersion: PLAN_STATE_SCHEMA_VERSION,
		mode,
		todos: [] as TodoItem[],
		continuationCount: 0,
		noProgressContinuationCount: 0,
		currentAgentProgressCount: 0,
	};
}

export function normalizeStoredTodoItems(items: TodoItem[]): TodoItem[] {
	return items.map((item, index) => {
		const status = item.status ?? (item.completed ? 'completed' : 'pending');
		return {
			...item,
			id: item.id ?? `${item.source === 'blocked_command' ? 'blocked-command' : 'task'}-${index + 1}`,
			step: item.step ?? index + 1,
			completed: status === 'completed',
			status,
		};
	});
}

export function normalizeStoredPlan(plan: PlanProposal | undefined): PlanProposal | undefined {
	if (!plan) return undefined;
	return {
		title: plan.title,
		summary: plan.summary,
		steps: plan.steps,
		assumptions: plan.assumptions ?? [],
		verification: plan.verification ?? [],
		risks: plan.risks ?? [],
		files: plan.files ?? [],
	};
}

export function resolveLegacyMode(data: PlanModeEntryData): PlanModeStateName {
	return data.executing
		? 'executing'
		: data.mode ??
			(data.enabled
				? data.todos?.length
					? 'approval'
					: 'planning'
				: 'normal');
}
