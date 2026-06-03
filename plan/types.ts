import type { CommandAllowlist, TodoItem } from './utils.js';

export type PhaseName = 'plan' | 'execute' | 'normal';
export type PlanModeStateName = 'normal' | 'planning' | 'approval' | 'executing';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type TaskStatus = TodoItem['status'];
export type ApprovalEffect = 'start_execution' | 'view_plan' | 'open_editor' | 'dismiss_approval' | 'quit_plan';

export type PlanEvent =
	| { type: 'TOGGLE' }
	| { type: 'PROPOSE'; plan: PlanProposal }
	| { type: 'BLOCKED_CMD' }
	| { type: 'APPROVAL_CHOICE'; effect: ApprovalEffect }
	| { type: 'PLAN_EDITED'; plan: PlanProposal }
	| { type: 'ALL_COMPLETE' }
	| { type: 'TASK_BLOCKED' }
	| { type: 'CONTINUE'; todo: TodoItem }
	| { type: 'NO_PROGRESS_RETRY'; todo: TodoItem }
	| { type: 'CONTINUATION_LIMIT' };

export interface TransitionResult {
	mode: PlanModeStateName;
	actions: Array<TransitionAction>;
}

export type TransitionAction =
	| { type: 'apply_phase'; phase: PhaseName }
	| { type: 'notify'; message: string; level: 'info' | 'warning' }
	| { type: 'reset_state'; mode: PlanModeStateName; clearTodos: boolean }
	| { type: 'persist' }
	| { type: 'update_status' }
	| { type: 'send_handoff'; todo: TodoItem; reason: 'start' | 'continue' }
	| { type: 'send_no_progress_continuation'; todo: TodoItem }
	| { type: 'finish_execution'; completed: boolean }
	| { type: 'show_approval_ui'; plan?: PlanProposal };

export interface PhaseProfile {
	provider?: string;
	model?: string;
	thinking?: ThinkingLevel;
	tools?: string[];
	context?: string;
	instructions?: string[];
	planCommandAllow?: CommandAllowlist;
}

export interface PhaseProfilesConfig {
	profiles?: Partial<Record<PhaseName, PhaseProfile>>;
}

export interface PendingBlockedCommand {
	toolName: 'bash';
	command: string;
	text: string;
}

export interface PlanProposalInput {
	title: string;
	summary: string;
	steps: string[];
	assumptions?: string[];
	verification?: string[];
	risks?: string[];
	files?: string[];
}

export interface PlanProposal {
	title: string;
	summary: string;
	steps: string[];
	assumptions: string[];
	verification: string[];
	risks: string[];
	files: string[];
}

export interface PlanRuntimeState {
	schemaVersion: 2;
	mode: PlanModeStateName;
	todos: TodoItem[];
	pendingBlockedCommand?: PendingBlockedCommand;
	pendingPlan?: PlanProposal;
	continuationCount: number;
	noProgressContinuationCount: number;
	currentAgentProgressCount: number;
}

export interface ApprovalTransition {
	mode: PlanModeStateName;
	effect: ApprovalEffect;
}

export interface ToolGuardDecision {
	block: boolean;
	reason: string;
	blockedCommand?: PendingBlockedCommand;
}

export interface PlanTaskUpdateInput {
	taskId: string;
	status: TaskStatus;
	message?: string;
}
