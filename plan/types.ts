import type { TodoItem } from './utils.js';

export type PhaseName = 'plan' | 'execute' | 'normal';
export type PlanModeStateName = 'normal' | 'planning' | 'approval' | 'refining' | 'executing' | 'format_repair';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type TaskStatus = TodoItem['status'];
export type PlanRefinementMode = 'supplement' | 'redefine';
export type ApprovalEffect = 'start_execution' | 'open_refinement' | 'open_editor' | 'dismiss_approval';

export interface PhaseProfile {
	provider?: string;
	model?: string;
	thinking?: ThinkingLevel;
	tools?: string[];
	context?: string;
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
