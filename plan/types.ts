import type { CommandAllowlist, TodoItem } from './utils.js';

export type PhaseName = 'plan' | 'execute' | 'normal';
export type PlanModeStateName = 'normal' | 'planning' | 'approval' | 'executing';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type TaskStatus = TodoItem['status'];
export type ApprovalEffect = 'start_execution' | 'open_refinement' | 'open_editor' | 'dismiss_approval' | 'quit_plan';

export type PlanEvent =
	| { type: 'TOGGLE' }
	| { type: 'PROPOSE'; plan: PlanProposal }
	| { type: 'APPROVAL_CHOICE'; effect: ApprovalEffect }
	| { type: 'REFINE_SUBMITTED' }
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
	| { type: 'finish_execution'; completed: boolean };

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
	/** Optional Tirith security enrichment for Plan Mode bash guards. */
	tirith?: TirithConfig;
}

export interface TirithConfig {
	/** Opt in to tirith enrichment. Default: disabled. */
	enabled?: boolean;
	/** Override the tirith binary path. Falls back to $TIRITH_BIN, then `tirith`. */
	binary?: string;
	/** execFileSync timeout in ms. Default: 10000. */
	timeoutMs?: number;
	/** Warn (tirith exit 2) handling. `allow` keeps the caller's severity; `deny` escalates to a hard block. Default: `allow`. */
	warnAction?: 'allow' | 'deny';
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
	schemaVersion: 3;
	mode: PlanModeStateName;
	todos: TodoItem[];
	pendingPlan?: PlanProposal;
	runtimeSnapshot?: RuntimeSnapshot;
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
	/**
	 * 'destructive' commands hard-block without confirmation (always-rejected side effects).
	 * 'unknown' commands may still be approved via the read-only inspection prompt.
	 */
	severity?: 'destructive' | 'unknown';
}

export interface PlanTaskUpdateInput {
	taskId: string;
	status: TaskStatus;
	message?: string;
}

export interface RuntimeSnapshot {
	provider?: string;
	model?: string;
	thinking: ThinkingLevel;
	tools: string[];
}

export interface ConfigDiagnostic {
	message: string;
}
