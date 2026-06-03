/**
 * Plan Mode Extension with Phase Profiles
 *
 * Adds deterministic phase routing on top of the existing plan mode:
 * - plan phase: broad tools with side-effect guards + optional high-reasoning model/provider
 * - execute phase: full tools + optional cheaper/faster model/provider
 * - session restore: reapplies the active phase profile
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AssistantMessage, TextContent } from '@mariozechner/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { Key } from '@mariozechner/pi-tui';
import type {
	PlanModeStateName,
	PlanProposal,
	PlanProposalInput,
	PlanRuntimeState,
	PlanTaskUpdateInput,
} from './types.js';
import type { TodoItem } from './utils.js';
import type { PlanModeEntryData } from './state.js';
import {
	PLAN_PROPOSAL_TOOL,
	PLAN_TASK_UPDATE_TOOL,
	PLAN_MODE_TOOLS,
	APPROVAL_CHOICES,
	FORMAT_REPAIR_CHOICES,
	MAX_AUTO_CONTINUATIONS,
	MAX_NO_PROGRESS_CONTINUATIONS,
	PLAN_PROPOSAL_PARAMETERS,
	PLAN_TASK_UPDATE_PARAMETERS,
	phaseForMode,
	isPlanModeActive,
	transitionApproval,
} from './constants.js';
import { readConfig, getProfile, getPlanModeTools, applyPhaseProfile } from './config.js';
import { createPlanState, normalizeStoredTodoItems, normalizeStoredPlan, resolveLegacyMode } from './state.js';
import { writeToolGuard, shellSideEffectGuard } from './guards.js';
import {
	isAssistantMessage,
	getTextContent,
	todoFromBlockedCommand,
	hasMalformedPlanSignal,
	normalizePlanText,
	normalizePlanProposal,
	todosFromPlanProposal,
	formatTodoLine,
	formatPlanProposal,
	formatApprovedPlanContext,
	formatEditablePlan,
	parseEditablePlan,
} from './format.js';
import { extractTodoItems, markCompletedSteps } from './utils.js';

export default function planModeExtension(pi: ExtensionAPI): void {
	const config = readConfig();
	let state = createPlanState() as PlanRuntimeState;

	pi.registerFlag('plan', {
		description: 'Start in plan mode (side-effect guarded planning)',
		type: 'boolean',
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		const phaseProfile = getProfile(config, phaseForMode(state.mode));
		const modelLabel =
			phaseProfile.provider && phaseProfile.model ? ` ${phaseProfile.provider}/${phaseProfile.model}` : '';
		const thinkingLabel = phaseProfile.thinking ? ` ${phaseProfile.thinking}` : '';

		if (state.mode === 'executing' && state.todos.length > 0) {
			const completed = state.todos.filter((t) => t.status === 'completed').length;
			ctx.ui.setStatus(
				'plan-mode',
				ctx.ui.theme.fg('accent', `📋 ${completed}/${state.todos.length}${modelLabel}${thinkingLabel}`),
			);
		} else if (isPlanModeActive(state.mode)) {
			ctx.ui.setStatus('plan-mode', ctx.ui.theme.fg('warning', `⏸ plan${modelLabel}${thinkingLabel}`));
		} else {
			ctx.ui.setStatus('plan-mode', undefined);
		}

		if (state.mode === 'executing' && state.todos.length > 0) {
			const lines = state.todos.map((item) => {
				if (item.status === 'completed') {
					return (
						ctx.ui.theme.fg('success', '☑ ') +
						ctx.ui.theme.fg('muted', ctx.ui.theme.strikethrough(item.text))
					);
				}
				if (item.status === 'blocked') {
					return `${ctx.ui.theme.fg('warning', '⚠ ')}${item.text}`;
				}
				if (item.status === 'in_progress') {
					return `${ctx.ui.theme.fg('accent', '◐ ')}${item.text}`;
				}
				return `${ctx.ui.theme.fg('muted', '☐ ')}${item.text}`;
			});
			ctx.ui.setWidget('plan-todos', lines);
		} else {
			ctx.ui.setWidget('plan-todos', undefined);
		}
	}

	async function enterMode(ctx: ExtensionContext, mode: PlanModeStateName): Promise<void> {
		state.mode = mode;
		await applyPhaseProfile(pi, ctx, config, phaseForMode(mode));
		updateStatus(ctx);
	}

	function resetPlanState(mode: PlanModeStateName = 'normal', clearTodos = true): void {
		const todos = clearTodos ? [] : state.todos;
		state = {
			...createPlanState(mode),
			todos,
		} as PlanRuntimeState;
	}

	async function finishExecution(ctx: ExtensionContext, completed: boolean): Promise<void> {
		if (completed && state.todos.length > 0) {
			const completedList = state.todos.map((t) => `~~${t.text}~~`).join('\n');
			pi.sendMessage(
				{ customType: 'plan-complete', content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
				{ triggerTurn: false },
			);
		} else if (!completed && state.todos.length > 0) {
			const blockedList = state.todos
				.filter((t) => t.status !== 'completed')
				.map((t) => `${t.status === 'blocked' ? '!' : '○'} ${t.text}${t.message ? `\n  ${t.message}` : ''}`)
				.join('\n');
			pi.sendMessage(
				{
					customType: 'plan-blocked',
					content: `**Plan Blocked**\n\n${blockedList}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}

		resetPlanState('normal');
		await enterMode(ctx, 'normal');
		persistState();
	}

	async function exitPlanMode(ctx: ExtensionContext, notify?: string): Promise<void> {
		resetPlanState('normal');
		await enterMode(ctx, 'normal');
		if (notify) {
			ctx.ui.notify(notify, 'info');
		}
		persistState();
	}

	async function togglePlanMode(ctx: ExtensionContext): Promise<void> {
		if (state.mode === 'executing') {
			resetPlanState('normal');
			await enterMode(ctx, 'normal');
			ctx.ui.notify('Previous plan execution state cleared. Starting a new plan.', 'info');
		}

		const nextMode: PlanModeStateName = isPlanModeActive(state.mode) ? 'normal' : 'planning';
		resetPlanState(nextMode);

		if (nextMode === 'planning') {
			await enterMode(ctx, 'planning');
			ctx.ui.notify(`Plan mode enabled. Tools: ${getPlanModeTools(getProfile(config, 'plan')).join(', ')}`);
		} else {
			await enterMode(ctx, 'normal');
			ctx.ui.notify('Plan mode disabled. Full access restored.');
		}
		persistState();
	}

	function persistState(): void {
		pi.appendEntry('plan-mode', {
			schemaVersion: state.schemaVersion,
			mode: state.mode,
			enabled: isPlanModeActive(state.mode),
			todos: state.todos,
			executing: state.mode === 'executing',
			phase: phaseForMode(state.mode),
			pendingBlockedCommand: state.pendingBlockedCommand,
			pendingPlan: state.pendingPlan,
			continuationCount: state.continuationCount,
			noProgressContinuationCount: state.noProgressContinuationCount,
		});
	}

	function getCurrentPlanForRefinement(): PlanProposal | undefined {
		if (state.pendingPlan) return state.pendingPlan;
		if (state.todos.length === 0) return undefined;
		return normalizePlanProposal({
			title: 'Current plan',
			summary: 'Current extracted plan steps.',
			steps: state.todos.map((todo) => todo.text),
			assumptions: [],
		});
	}

	function sendRefinementMessage(refinement: string, mode: 'supplement' | 'redefine', plan?: PlanProposal): void {
		const message = refinement.trim();
		if (message) {
			const currentPlanText = plan
				? `\n\nCurrent plan:\n${formatEditablePlan(plan)}`
				: '\n\nCurrent plan: not available from structured state. Use the latest conversation context as the plan baseline.';
			const modeText =
				mode === 'supplement'
					? 'Supplement the current plan: preserve its intent and incorporate the refinement as additions or targeted adjustments.'
					: 'Redefine the plan: treat the refinement as replacing the current direction where it conflicts.';
			pi.sendUserMessage(
				`Refine the Plan Mode proposal.\n\nMode: ${modeText}${currentPlanText}\n\nUser refinement:\n${message}\n\nReturn one complete revised plan by calling propose_plan. Do not execute, edit files, or provide a partial diff while refining.`,
				{ deliverAs: 'followUp' },
			);
		}
	}

	async function promptForPlanRefinement(ctx: ExtensionContext): Promise<void> {
		state.mode = 'refining';
		persistState();
		const modeChoice = await ctx.ui.select('How should this refinement change the plan?', [
			'Supplement current plan',
			'Redefine plan',
		]);
		if (!modeChoice) {
			await enterMode(ctx, 'approval');
			persistState();
			return;
		}

		const mode: 'supplement' | 'redefine' = modeChoice === 'Redefine plan' ? 'redefine' : 'supplement';
		const prompt = mode === 'redefine' ? 'Redefine the plan:' : 'Supplement the plan:';
		const refinement = await ctx.ui.editor(prompt, '');
		if (!refinement?.trim()) {
			await enterMode(ctx, 'approval');
			persistState();
			return;
		}
		state.mode = 'planning';
		persistState();
		sendRefinementMessage(refinement, mode, getCurrentPlanForRefinement());
	}

	function remainingTodos(): TodoItem[] {
		return state.todos.filter((todo) => todo.status !== 'completed');
	}

	function sendExecutionHandoff(firstTodo: TodoItem | undefined, reason: 'start' | 'continue' = 'start'): void {
		const modeText = 'Execute autonomously while reporting structured task progress.';
		const execMessage =
			firstTodo?.source === 'blocked_command' && firstTodo.command
				? `Execute the captured Plan Mode command, then verify the result:\n\n\`\`\`bash\n${firstTodo.command}\n\`\`\``
				: reason === 'continue'
				  ? `Continue executing the approved plan.\n\nMode: ${modeText}\n\nNext task: ${firstTodo ? formatTodoLine(firstTodo) : 'the first remaining task'}`
				  : `Execute the approved plan.\n\nMode: ${modeText}\n\nStart with: ${firstTodo ? formatTodoLine(firstTodo) : 'the first task'}`;
		pi.sendMessage(
			{ customType: 'plan-mode-execute', content: execMessage, display: true },
			{ triggerTurn: true, deliverAs: 'followUp' },
		);
	}

	function sendNoProgressContinuation(firstTodo: TodoItem | undefined): void {
		pi.sendMessage(
			{
				customType: 'plan-mode-execute',
				content: `Continue executing the approved plan.\n\nThe previous turn ended without structured task progress. Work on ${firstTodo ? formatTodoLine(firstTodo) : 'the first remaining task'} and call plan_task_update before stopping. If no task can move forward, mark it blocked with a short reason.`,
				display: true,
			},
			{ triggerTurn: true, deliverAs: 'followUp' },
		);
	}

	async function promptForPlanExecution(ctx: ExtensionContext, plan?: PlanProposal): Promise<void> {
		state.mode = 'approval';
		const proposalContent = plan ? formatPlanProposal(plan) : undefined;
		if (plan) {
			pi.sendMessage(
				{
					customType: 'plan-proposal',
					content: proposalContent ?? formatPlanProposal(plan),
					display: true,
					details: plan,
				},
				{ triggerTurn: false },
			);
		} else {
			const todoListText = state.todos.map((t, i) => `${i + 1}. ☐ ${t.text}`).join('\n');
			pi.sendMessage(
				{
					customType: 'plan-todo-list',
					content: `**Plan Steps (${state.todos.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}

		const choice = await ctx.ui.select('Plan proposal - what next?', [...APPROVAL_CHOICES]);

		const firstTodo = state.todos[0];
		const transition = transitionApproval(choice);

		if (transition.effect === 'start_execution') {
			state.mode = 'executing';
			state.continuationCount = 0;
			state.noProgressContinuationCount = 0;
			state.currentAgentProgressCount = 0;
			state.pendingBlockedCommand = undefined;
			await enterMode(ctx, 'executing');
			persistState();

			sendExecutionHandoff(firstTodo);
		} else if (transition.effect === 'open_editor') {
			const basePlan =
				state.pendingPlan ??
				normalizePlanProposal({
					title: 'Plan',
					summary: 'Edited legacy plan.',
					steps: state.todos.map((todo) => todo.text),
					assumptions: [],
				});
			const original = formatEditablePlan(basePlan);
			const edited = await ctx.ui.editor('Edit plan:', original);
			if (edited?.trim() && edited !== original) {
				state.pendingPlan = parseEditablePlan(edited, basePlan);
				state.todos = todosFromPlanProposal(state.pendingPlan);
				persistState();
				await promptForPlanExecution(ctx, state.pendingPlan);
				return;
			}
			state.mode = 'approval';
			updateStatus(ctx);
			persistState();
		} else if (transition.effect === 'open_refinement') {
			await promptForPlanRefinement(ctx);
		} else {
			state.mode = transition.mode;
			persistState();
			updateStatus(ctx);
		}
	}

	function requestPlanFormatRepair(): void {
		state.mode = 'format_repair';
		persistState();
		pi.sendMessage(
			{
				customType: 'plan-format-repair',
				content: `Plan Mode could not extract executable steps from the previous response. Re-output the plan only, using exactly one <proposed_plan> block with numbered top-level implementation steps. Do not run tools, do not suggest manual commands, and do not include extra explanation outside the block.`,
				display: false,
			},
			{ triggerTurn: true },
		);
	}

	function updateTaskStatus(update: PlanTaskUpdateInput): TodoItem {
		const taskId = normalizePlanText(update.taskId, 'taskId');
		const status = update.status;
		if (!['pending', 'in_progress', 'completed', 'blocked'].includes(status)) {
			throw new Error('plan_task_update.status must be pending, in_progress, completed, or blocked.');
		}

		const task = state.todos.find((todo) => todo.id === taskId);
		if (!task) {
			throw new Error(`Unknown plan task id: ${taskId}`);
		}

		const message = update.message === undefined ? undefined : normalizePlanText(update.message, 'message');
		const changed = task.status !== status || (message !== undefined && task.message !== message);
		task.status = status;
		task.completed = status === 'completed';
		if (message !== undefined) {
			task.message = message;
		}
		if (changed) {
			state.currentAgentProgressCount += 1;
			state.noProgressContinuationCount = 0;
		}
		return task;
	}

	// ── Tool registration ──────────────────────────────────────────

	pi.registerTool({
		name: PLAN_PROPOSAL_TOOL,
		label: 'Propose Plan',
		description:
			'Submit a structured implementation plan while Plan Mode is active. This stores tracked steps and asks the user whether to execute them.',
		promptSnippet: 'Submit a structured Plan Mode proposal for implementation or refactor requests.',
		promptGuidelines: [
			'Use propose_plan when Plan Mode needs an executable implementation, fix, refactor, or verification plan.',
			'Put key code findings, constraints, tradeoffs, and execution-critical context in summary, assumptions, risks, verification, and files.',
			'Include explicit assumptions/defaults when planning without asking a clarifying question.',
			'Do not ask the user to reply yes or no in chat for execution approval; propose_plan will trigger the harness approval UI.',
		],
		parameters: PLAN_PROPOSAL_PARAMETERS,
		async execute(_toolCallId, params: PlanProposalInput, _signal, _onUpdate, ctx) {
			if (!isPlanModeActive(state.mode)) {
				throw new Error('propose_plan can only be used while Plan Mode is active.');
			}

			const plan = normalizePlanProposal(params);
			state.pendingPlan = plan;
			state.todos = todosFromPlanProposal(plan);
			state.mode = 'approval';
			state.pendingBlockedCommand = undefined;
			persistState();

			if (ctx.hasUI) {
				await promptForPlanExecution(ctx, plan);
			}

			return {
				content: [
					{
						type: 'text',
						text: ctx.hasUI
							? 'Structured plan submitted to Plan Mode.'
							: 'Structured plan submitted.',
					},
				],
				details: { plan, todos: state.todos },
				terminate: true,
			};
		},
	});

	pi.registerTool({
		name: PLAN_TASK_UPDATE_TOOL,
		label: 'Plan Task Update',
		description:
			'Update the status of one approved plan task during execution. Use this instead of prose-only progress markers.',
		promptSnippet: 'Report approved plan task progress with task id and status.',
		promptGuidelines: [
			'Call plan_task_update when starting, completing, or blocking an approved plan task.',
			'Use task ids shown in the execution context, such as task-1.',
			'If a task cannot continue, mark it blocked with a short message instead of silently stopping.',
		],
		parameters: PLAN_TASK_UPDATE_PARAMETERS,
		async execute(_toolCallId, params: PlanTaskUpdateInput, _signal, _onUpdate, ctx) {
			if (state.mode !== 'executing') {
				throw new Error('plan_task_update can only be used while executing an approved plan.');
			}
			const task = updateTaskStatus(params);
			persistState();
			updateStatus(ctx);
			return {
				content: [
					{
						type: 'text',
						text: `${task.id} is ${task.status}.`,
					},
				],
				details: { task },
			};
		},
	});

	// ── Commands & shortcuts ───────────────────────────────────────

	pi.registerCommand('plan', {
		description: 'Toggle plan mode (side-effect guarded planning)',
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand('todos', {
		description: 'Show current plan todo list',
		handler: async (_args, ctx) => {
			if (state.todos.length === 0) {
				ctx.ui.notify('No todos. Create a plan first with /plan', 'info');
				return;
			}
			const list = state.todos
				.map((item, i) => `${i + 1}. ${item.status === 'completed' ? '✓' : item.status === 'blocked' ? '!' : '○'} ${item.id} ${item.text}`)
				.join('\n');
			ctx.ui.notify(`Plan Progress:\n${list}`, 'info');
		},
	});

	pi.registerShortcut(Key.alt('i'), {
		description: 'Toggle plan mode',
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// ── Event handlers ─────────────────────────────────────────────

	pi.on('tool_call', async (event) => {
		if (!isPlanModeActive(state.mode)) return;

		const writeDecision = writeToolGuard(event.toolName);
		if (writeDecision) {
			return writeDecision;
		}

		if (event.toolName !== 'bash') return;

		const command = event.input.command as string;
		const shellDecision = shellSideEffectGuard(command);
		if (shellDecision) {
			if (!state.pendingBlockedCommand && shellDecision.blockedCommand) {
				state.pendingBlockedCommand = shellDecision.blockedCommand;
				persistState();
			}
			return {
				block: shellDecision.block,
				reason: shellDecision.reason,
			};
		}
	});

	pi.on('context', async (event) => {
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (
					msg.customType === 'plan-mode-context' ||
					msg.customType === 'phase-profile-context' ||
					msg.customType === 'plan-execution-context'
				) {
					return false;
				}
				if (msg.role !== 'user') return true;

				const content = msg.content;
				if (typeof content === 'string') {
					return (
						!content.includes('[PLAN MODE ACTIVE]') &&
						!content.includes('[PHASE PROFILE]') &&
						!content.includes('[EXECUTING PLAN')
					);
				}
				if (Array.isArray(content)) {
					return !content.some((c) => {
						const text = c.type === 'text' ? (c as TextContent).text : undefined;
						return (
							text?.includes('[PLAN MODE ACTIVE]') ||
							text?.includes('[PHASE PROFILE]') ||
							text?.includes('[EXECUTING PLAN')
						);
					});
				}
				return true;
			}),
		};
	});

	pi.on('before_agent_start', async () => {
		const phase = phaseForMode(state.mode);
		const profile = getProfile(config, phase);
		const phaseContext = profile.context ? `\n\n[PHASE PROFILE: ${phase}]\n${profile.context}` : '';
		const activePlanTools = phase === 'plan' ? getPlanModeTools(profile) : (profile.tools ?? PLAN_MODE_TOOLS);

		if (isPlanModeActive(state.mode)) {
			return {
				message: {
					customType: 'plan-mode-context',
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a side-effect guarded planning mode for safe code analysis.

Restrictions:
- Available tools: ${activePlanTools.join(', ')}
- You CANNOT modify files, repositories, dependencies, services, or external state.
- You CANNOT call edit, write, apply_patch, or any other write-capable tool while Plan Mode is active.
- Bash commands that may change files, dependencies, git state, processes, or system state are blocked.
- If the user asks you to implement, edit, execute, continue, or apply changes while plan mode is active, treat that as a request to plan the execution. Do not attempt to execute it.
- Do not try write-capable shell commands such as perl -pi, python scripts that write files, sed -i, cp, mv, tee, or shell redirection.
- If the user wants to proceed after a plan exists, use propose_plan so the approval UI can start execution automatically. Do not ask for a yes/no chat reply and do not tell them to apply shell commands manually.

Workflow:
1. Inspect the relevant code and environment without side effects.
2. Identify intent, success criteria, scope, constraints, current state, and key tradeoffs.
3. Ask when a high-impact preference or requirement cannot be derived from repository context:
   - Use the questionnaire tool. Provide 2-4 concrete options plus a "Custom / Other" option.
   - After receiving answers, incorporate the decisions into your approach.
4. If you proceed without asking, state the default assumptions explicitly in propose_plan.assumptions.

Once the approach is clear for a fix, change, implementation, or refactor request, call propose_plan with:
- title: short title
- summary: brief summary, including key code findings, constraints, and implementation judgment needed during execution
- steps: ordered implementation steps
- assumptions: explicit defaults or assumptions, especially for any skipped questions
- verification: verification commands or scenarios
- risks: optional risk notes
- files: optional likely touched files or modules

Do not ask the user "should I apply this?" in plain text. The propose_plan tool triggers the harness approval UI.

For pure analysis tasks, respond directly with findings, risks, trade-offs, and recommendations, without calling propose_plan.

Do NOT attempt to make changes - just describe what you would do.${phaseContext}`,
					display: false,
				},
			};
		}

		if (state.mode === 'executing' && state.todos.length > 0) {
			const remaining = remainingTodos();
			const todoList = remaining.map((t) => `${t.id} [${t.status}] ${t.text}`).join('\n');
			const approvedPlanContext = formatApprovedPlanContext(state.pendingPlan);
			return {
				message: {
					customType: 'plan-execution-context',
					content: `[EXECUTING PLAN - Full tool access enabled]
${approvedPlanContext}

Remaining steps:
${todoList}

Execute each step in order.
Use plan_task_update when a task starts, completes, or becomes blocked.
Only mark a task completed after it has been fully implemented and minimally verified.
Legacy [DONE:n] markers are accepted as fallback, but plan_task_update is the canonical progress protocol.${phaseContext}`,
					display: false,
				},
			};
		}
	});

	pi.on('turn_end', async (event, ctx) => {
		if (state.mode !== 'executing' || state.todos.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		const completed = markCompletedSteps(text, state.todos);
		if (completed > 0) {
			state.currentAgentProgressCount += completed;
			state.noProgressContinuationCount = 0;
			updateStatus(ctx);
		}
		if (state.todos.length > 0 && state.todos.every((t) => t.status === 'completed')) {
			await finishExecution(ctx, true);
			return;
		}
		persistState();
	});

	pi.on('agent_end', async (event, ctx) => {
		if (state.mode === 'executing' && state.todos.length > 0) {
			if (state.todos.every((t) => t.status === 'completed')) {
				await finishExecution(ctx, true);
				return;
			}

			const remaining = remainingTodos();
			if (state.todos.some((todo) => todo.status === 'blocked')) {
				const blocked = state.todos.filter((todo) => todo.status === 'blocked');
				ctx.ui.notify(
					`Plan execution blocked: ${blocked.length} task(s) blocked. Run /plan to create a revised plan.`,
					'warning',
				);
				await finishExecution(ctx, false);
				return;
			}

			if (state.currentAgentProgressCount === 0) {
				if (state.noProgressContinuationCount < MAX_NO_PROGRESS_CONTINUATIONS) {
					state.noProgressContinuationCount += 1;
					state.currentAgentProgressCount = 0;
					persistState();
					sendNoProgressContinuation(remaining[0]);
					return;
				}

				ctx.ui.notify(
					`Plan execution blocked: no task progress was reported after ${MAX_NO_PROGRESS_CONTINUATIONS} retries.`,
					'warning',
				);
				if (remaining[0]) {
					remaining[0].status = 'blocked';
					remaining[0].completed = false;
					remaining[0].message = `No structured task progress was reported after ${MAX_NO_PROGRESS_CONTINUATIONS} retries.`;
				}
				await finishExecution(ctx, false);
				return;
			}

			if (state.continuationCount >= MAX_AUTO_CONTINUATIONS) {
				ctx.ui.notify(
					`Plan execution blocked after ${MAX_AUTO_CONTINUATIONS} automatic continuations.`,
					'warning',
				);
				if (remaining[0]) {
					remaining[0].status = 'blocked';
					remaining[0].completed = false;
					remaining[0].message = `Automatic continuation limit reached with ${remaining.length} remaining task(s).`;
				}
				await finishExecution(ctx, false);
				return;
			}

			state.continuationCount += 1;
			state.noProgressContinuationCount = 0;
			state.currentAgentProgressCount = 0;
			persistState();
			sendExecutionHandoff(remaining[0], 'continue');
			return;
		}

		if (!isPlanModeActive(state.mode) || !ctx.hasUI) return;
		if (state.mode === 'approval' || state.mode === 'refining') return;

		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		const lastAssistantText = lastAssistant ? getTextContent(lastAssistant) : '';
		const extracted = lastAssistantText ? extractTodoItems(lastAssistantText) : [];
		let shouldOpenApproval = false;
		if (extracted.length > 0) {
			state.todos = extracted;
			state.mode = 'approval';
			state.pendingBlockedCommand = undefined;
			state.pendingPlan = undefined;
			shouldOpenApproval = true;
			persistState();
		} else if (state.pendingBlockedCommand) {
			state.todos = [todoFromBlockedCommand(state.pendingBlockedCommand)];
			state.mode = 'approval';
			state.pendingBlockedCommand = undefined;
			shouldOpenApproval = true;
			persistState();
		} else if (state.mode !== 'format_repair' && hasMalformedPlanSignal(lastAssistantText)) {
			requestPlanFormatRepair();
			return;
		}

		if (state.todos.length === 0) {
			if (state.mode === 'format_repair') {
				state.mode = 'planning';
				persistState();
				ctx.ui.notify(
					'Plan Mode could not extract executable steps. Refine the plan, submit a structured plan, or exit Plan Mode.',
					'warning',
				);
				const choice = await ctx.ui.select('Plan format not recognized', [...FORMAT_REPAIR_CHOICES]);
				if (choice === 'Refine the plan') {
					await promptForPlanRefinement(ctx);
				} else if (choice === 'Exit plan mode') {
					await exitPlanMode(ctx, 'Plan mode exited.');
				} else if (!choice) {
					state.mode = 'planning';
					persistState();
				}
			}
			return;
		}

		if (shouldOpenApproval) {
			await promptForPlanExecution(ctx);
		}
	});

	pi.on('session_start', async (_event, ctx) => {
		if (pi.getFlag('plan') === true) {
			state = createPlanState('planning') as PlanRuntimeState;
		}

		const entries = ctx.sessionManager.getEntries();

		let planModeEntryIndex = -1;
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as { type: string; customType?: string };
			if (entry.type === 'custom' && entry.customType === 'plan-mode') {
				planModeEntryIndex = i;
				break;
			}
		}
		const planModeEntry = (planModeEntryIndex >= 0 ? entries[planModeEntryIndex] : undefined) as
			| { data?: PlanModeEntryData }
			| undefined;

		if (planModeEntry?.data) {
			const data = planModeEntry.data;
			const legacyMode = resolveLegacyMode(data);
			state = {
				schemaVersion: 2 as const,
				mode: legacyMode,
				todos: normalizeStoredTodoItems(data.todos ?? state.todos),
				pendingBlockedCommand: data.pendingBlockedCommand,
				pendingPlan: normalizeStoredPlan(data.pendingPlan),
				continuationCount: data.continuationCount ?? 0,
				noProgressContinuationCount: data.noProgressContinuationCount ?? 0,
				currentAgentProgressCount: 0,
			};
		}

		const isResume = planModeEntry !== undefined;
		if (isResume && state.mode === 'executing' && state.todos.length > 0) {
			const messages: AssistantMessage[] = [];
			for (let i = planModeEntryIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (
					entry.type === 'message' &&
					'message' in entry &&
					isAssistantMessage(entry.message as AgentMessage)
				) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join('\n');
			markCompletedSteps(allText, state.todos);
		}

		if (state.mode === 'executing' && (state.todos.length === 0 || state.todos.every((todo) => todo.status === 'completed'))) {
			resetPlanState('normal');
			persistState();
		}

		await enterMode(ctx, state.mode);
	});
}
