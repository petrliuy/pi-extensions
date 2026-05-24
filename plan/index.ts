/**
 * Plan Mode Extension with Phase Profiles
 *
 * Adds deterministic phase routing on top of the existing plan mode:
 * - plan phase: read-only tools + optional high-reasoning model/provider
 * - execute phase: full tools + optional cheaper/faster model/provider
 * - session restore: reapplies the active phase profile
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AssistantMessage, TextContent } from '@mariozechner/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { Key } from '@mariozechner/pi-tui';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from './utils.js';

const PLAN_PROPOSAL_TOOL = 'propose_plan';
const PLAN_TASK_UPDATE_TOOL = 'plan_task_update';
const PLAN_MODE_TOOLS = ['read', 'bash', 'grep', 'find', 'ls', 'questionnaire', PLAN_PROPOSAL_TOOL];
const NORMAL_MODE_TOOLS = ['read', 'bash', 'edit', 'write'];
const EXECUTE_MODE_TOOLS = [...NORMAL_MODE_TOOLS, PLAN_TASK_UPDATE_TOOL];
const PLAN_MODE_TOOL_ALLOWLIST = new Set(PLAN_MODE_TOOLS);
const PLAN_MODE_WRITE_TOOLS = new Set(['edit', 'write', 'apply_patch']);
const MAX_AUTO_CONTINUATIONS = 8;
const MAX_NO_PROGRESS_CONTINUATIONS = 2;

const CONFIG_PATH = join(homedir(), '.pi', 'agent', 'plan.json');

type PhaseName = 'plan' | 'execute' | 'normal';
type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

interface PhaseProfile {
    provider?: string;
    model?: string;
    thinking?: ThinkingLevel;
    tools?: string[];
    context?: string;
}

interface PhaseProfilesConfig {
    profiles?: Partial<Record<PhaseName, PhaseProfile>>;
}

interface PendingBlockedCommand {
    toolName: 'bash';
    command: string;
    text: string;
}

interface PlanProposalInput {
    title: string;
    summary: string;
    steps: string[];
    verification?: string[];
    risks?: string[];
    files?: string[];
}

interface PlanProposal {
    title: string;
    summary: string;
    steps: string[];
    verification: string[];
    risks: string[];
    files: string[];
}

type TaskStatus = TodoItem['status'];
type ExecutionModeChoice = 'auto' | 'manual_review';

interface PlanTaskUpdateInput {
    taskId: string;
    status: TaskStatus;
    message?: string;
}

const PLAN_PROPOSAL_PARAMETERS = {
    type: 'object',
    properties: {
        title: {
            type: 'string',
            description: 'Short title for the proposed plan.',
        },
        summary: {
            type: 'string',
            description: 'Brief summary of what the plan will accomplish.',
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

const PLAN_TASK_UPDATE_PARAMETERS = {
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

const DEFAULT_PROFILES: Record<PhaseName, PhaseProfile> = {
    plan: {
        thinking: 'high',
        tools: PLAN_MODE_TOOLS,
        context:
            'Use stronger reasoning. Focus on analysis, risks, trade-offs, and an executable plan. Do not edit files.',
    },
    execute: {
        thinking: 'medium',
        tools: EXECUTE_MODE_TOOLS,
        context:
            'Use implementation-focused reasoning. Prefer minimal diffs and complete the approved plan step by step.',
    },
    normal: {
        thinking: 'medium',
        tools: NORMAL_MODE_TOOLS,
    },
};

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
    return m.role === 'assistant' && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
    return message.content
        .filter((block): block is TextContent => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
}

function readConfig(): PhaseProfilesConfig {
    if (!existsSync(CONFIG_PATH)) return {};
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as PhaseProfilesConfig;
    } catch {
        return {};
    }
}

function getProfile(config: PhaseProfilesConfig, phase: PhaseName): PhaseProfile {
    return {
        ...DEFAULT_PROFILES[phase],
        ...(config.profiles?.[phase] ?? {}),
    };
}

function getPlanModeTools(profile: PhaseProfile): { tools: string[]; blocked: string[] } {
    const requestedTools = profile.tools ?? PLAN_MODE_TOOLS;
    const tools = requestedTools.filter((tool) => PLAN_MODE_TOOL_ALLOWLIST.has(tool));
    if (!tools.includes(PLAN_PROPOSAL_TOOL)) {
        tools.push(PLAN_PROPOSAL_TOOL);
    }
    const blocked = requestedTools.filter((tool) => !PLAN_MODE_TOOL_ALLOWLIST.has(tool));
    return {
        tools: tools.length > 0 ? tools : PLAN_MODE_TOOLS,
        blocked,
    };
}

function getExecuteModeTools(profile: PhaseProfile): string[] | undefined {
    if (!profile.tools?.length) return undefined;
    return profile.tools.includes(PLAN_TASK_UPDATE_TOOL) ? profile.tools : [...profile.tools, PLAN_TASK_UPDATE_TOOL];
}

function isPlanModeWriteTool(toolName: string): boolean {
    const normalized = toolName.toLowerCase();
    const shortName = normalized.split('.').pop() ?? normalized;
    return PLAN_MODE_WRITE_TOOLS.has(normalized) || PLAN_MODE_WRITE_TOOLS.has(shortName);
}

function getModelRegistry(ctx: ExtensionContext): { find?: (provider: string, model: string) => unknown } | undefined {
    return (ctx as unknown as { modelRegistry?: { find?: (provider: string, model: string) => unknown } })
        .modelRegistry;
}

function summarizeCommand(command: string): string {
    const summary = command.replace(/\s+/g, ' ').trim();
    if (summary.length <= 50) return summary;
    return `${summary.slice(0, 47)}...`;
}

function todoFromBlockedCommand(blocked: PendingBlockedCommand): TodoItem {
    return {
        id: 'blocked-command-1',
        step: 1,
        text: summarizeCommand(blocked.command),
        completed: false,
        status: 'pending',
        source: 'blocked_command',
        command: blocked.command,
    };
}

function hasMalformedPlanSignal(text: string): boolean {
    return text.includes('<proposed_plan') || text.includes('</proposed_plan>') || text.includes('Plan:');
}

function normalizePlanText(text: unknown, field: string): string {
    if (typeof text !== 'string' || text.trim().length === 0) {
        throw new Error(`${field} must be a non-empty string.`);
    }
    return text.trim();
}

function normalizePlanList(values: unknown, field: string, required: boolean): string[] {
    if (values === undefined && !required) return [];
    if (!Array.isArray(values)) {
        throw new Error(`${field} must be an array of strings.`);
    }
    const normalized = values
        .map((value, index) => normalizePlanText(value, `${field}[${index}]`))
        .filter((value) => value.length > 0);
    if (required && normalized.length === 0) {
        throw new Error(`${field} must contain at least one item.`);
    }
    return normalized;
}

function normalizePlanProposal(params: PlanProposalInput): PlanProposal {
    return {
        title: normalizePlanText(params.title, 'title'),
        summary: normalizePlanText(params.summary, 'summary'),
        steps: normalizePlanList(params.steps, 'steps', true),
        verification: normalizePlanList(params.verification, 'verification', false),
        risks: normalizePlanList(params.risks, 'risks', false),
        files: normalizePlanList(params.files, 'files', false),
    };
}

function todosFromPlanProposal(plan: PlanProposal): TodoItem[] {
    return plan.steps.map((step, index) => ({
        id: `task-${index + 1}`,
        step: index + 1,
        text: step,
        completed: false,
        status: 'pending',
        source: 'plan',
    }));
}

function formatPlanProposal(plan: PlanProposal): string {
    const steps = plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
    const verification =
        plan.verification.length > 0
            ? `\n\n**Verification**\n${plan.verification.map((step, index) => `${index + 1}. ${step}`).join('\n')}`
            : '';
    const risks =
        plan.risks.length > 0
            ? `\n\n**Risks**\n${plan.risks.map((risk, index) => `${index + 1}. ${risk}`).join('\n')}`
            : '';
    const files = plan.files.length > 0 ? `\n\n**Likely Files**\n${plan.files.join('\n')}` : '';
    return `**${plan.title}**\n\n${plan.summary}\n\n**Plan Steps (${plan.steps.length})**\n${steps}${verification}${risks}${files}`;
}

function normalizeStoredTodoItems(items: TodoItem[]): TodoItem[] {
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

function normalizeStoredPlan(plan: PlanProposal | undefined): PlanProposal | undefined {
    if (!plan) return undefined;
    return {
        title: plan.title,
        summary: plan.summary,
        steps: plan.steps,
        verification: plan.verification ?? [],
        risks: plan.risks ?? [],
        files: plan.files ?? [],
    };
}

async function applyPhaseProfile(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    config: PhaseProfilesConfig,
    phase: PhaseName,
): Promise<void> {
    const profile = getProfile(config, phase);
    const planTools = phase === 'plan' ? getPlanModeTools(profile) : undefined;
    const executeTools = phase === 'execute' ? getExecuteModeTools(profile) : undefined;

    if (planTools) {
        pi.setActiveTools(planTools.tools);
        if (planTools.blocked.length > 0) {
            ctx.ui.notify(`Plan phase ignored write-capable tools: ${planTools.blocked.join(', ')}`, 'warning');
        }
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

export default function planModeExtension(pi: ExtensionAPI): void {
    const config = readConfig();
    let planModeEnabled = false;
    let executionMode = false;
    let activePhase: PhaseName = 'normal';
    let todoItems: TodoItem[] = [];
    let planStage: 'inspect' | 'plan' = 'inspect';
    let pendingBlockedCommand: PendingBlockedCommand | undefined;
    let pendingPlan: PlanProposal | undefined;
    let formatRepairAttempted = false;
    let suppressNextPlanPrompt = false;
    let continuationCount = 0;
    let noProgressContinuationCount = 0;
    let currentAgentProgressCount = 0;
    let executionChoice: ExecutionModeChoice = 'auto';

    pi.registerFlag('plan', {
        description: 'Start in plan mode (read-only exploration)',
        type: 'boolean',
        default: false,
    });

    function updateStatus(ctx: ExtensionContext): void {
        const phaseProfile = getProfile(config, activePhase);
        const modelLabel =
            phaseProfile.provider && phaseProfile.model ? ` ${phaseProfile.provider}/${phaseProfile.model}` : '';
        const thinkingLabel = phaseProfile.thinking ? ` ${phaseProfile.thinking}` : '';

        if (executionMode && todoItems.length > 0) {
            const completed = todoItems.filter((t) => t.status === 'completed').length;
            ctx.ui.setStatus(
                'plan-mode',
                ctx.ui.theme.fg('accent', `📋 ${completed}/${todoItems.length}${modelLabel}${thinkingLabel}`),
            );
        } else if (planModeEnabled) {
            ctx.ui.setStatus('plan-mode', ctx.ui.theme.fg('warning', `⏸ plan${modelLabel}${thinkingLabel}`));
        } else {
            ctx.ui.setStatus('plan-mode', undefined);
        }

        if (executionMode && todoItems.length > 0) {
            const lines = todoItems.map((item) => {
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

    async function enterPhase(ctx: ExtensionContext, phase: PhaseName): Promise<void> {
        activePhase = phase;
        await applyPhaseProfile(pi, ctx, config, phase);
        updateStatus(ctx);
    }

    async function togglePlanMode(ctx: ExtensionContext): Promise<void> {
        if (executionMode) {
            ctx.ui.notify(
                'Plan mode cannot be toggled while execution is active. Use /execute to resume or wait for completion.',
                'warning',
            );
            return;
        }

        planModeEnabled = !planModeEnabled;
        executionMode = false;
        todoItems = [];
        planStage = 'inspect';
        pendingBlockedCommand = undefined;
        pendingPlan = undefined;
        formatRepairAttempted = false;
        suppressNextPlanPrompt = false;
        continuationCount = 0;
        noProgressContinuationCount = 0;
        currentAgentProgressCount = 0;
        executionChoice = 'auto';

        if (planModeEnabled) {
            await enterPhase(ctx, 'plan');
            ctx.ui.notify(
                `Plan mode enabled. Tools: ${(getProfile(config, 'plan').tools ?? PLAN_MODE_TOOLS).join(', ')}`,
            );
        } else {
            await enterPhase(ctx, 'normal');
            ctx.ui.notify('Plan mode disabled. Full access restored.');
        }
        persistState();
    }

    function persistState(): void {
        pi.appendEntry('plan-mode', {
            enabled: planModeEnabled,
            todos: todoItems,
            executing: executionMode,
            phase: activePhase,
            stage: planStage,
            pendingBlockedCommand,
            pendingPlan,
            formatRepairAttempted,
            continuationCount,
            noProgressContinuationCount,
            executionChoice,
        });
    }

    function sendRefinementMessage(refinement: string): void {
        const message = refinement.trim();
        if (message) {
            pi.sendUserMessage(message, { deliverAs: 'followUp' });
        }
    }

    function formatTodoLine(todo: TodoItem): string {
        return `${todo.id}. ${todo.text}`;
    }

    function remainingTodos(): TodoItem[] {
        return todoItems.filter((todo) => todo.status !== 'completed');
    }

    function sendExecutionHandoff(firstTodo: TodoItem | undefined, reason: 'start' | 'continue' = 'start'): void {
        const remaining = remainingTodos();
        const remainingText = remaining.map(formatTodoLine).join('\n');
        const modeText =
            executionChoice === 'manual_review'
                ? 'Execute conservatively and stop after meaningful changes for review if risk or ambiguity appears.'
                : 'Execute autonomously while reporting structured task progress.';
        const execMessage =
            firstTodo?.source === 'blocked_command' && firstTodo.command
                ? `Execute the captured Plan Mode command, then verify the result:\n\n\`\`\`bash\n${firstTodo.command}\n\`\`\``
                : reason === 'continue'
                  ? `Continue executing the approved plan.\n\nMode: ${modeText}\n\nRemaining tasks:\n${remainingText}`
                  : `Execute the approved plan.\n\nMode: ${modeText}\n\nStart with: ${firstTodo ? formatTodoLine(firstTodo) : 'the first task'}`;
        pi.sendMessage(
            { customType: 'plan-mode-execute', content: execMessage, display: true },
            { triggerTurn: true, deliverAs: 'followUp' },
        );
    }

    function sendNoProgressContinuation(firstTodo: TodoItem | undefined): void {
        const remaining = remainingTodos();
        const remainingText = remaining.map(formatTodoLine).join('\n');
        pi.sendMessage(
            {
                customType: 'plan-mode-execute',
                content: `Continue executing the approved plan.\n\nThe previous turn ended without structured task progress. Before stopping this turn, call plan_task_update for the task you work on. If no task can move forward, mark the task blocked with a short reason.\n\nRemaining tasks:\n${remainingText}\n\nStart with: ${firstTodo ? formatTodoLine(firstTodo) : 'the first remaining task'}`,
                display: true,
            },
            { triggerTurn: true, deliverAs: 'followUp' },
        );
    }

    function formatEditablePlan(plan: PlanProposal): string {
        const lines = [
            `Title: ${plan.title}`,
            `Summary: ${plan.summary}`,
            '',
            'Steps:',
            ...plan.steps.map((step, index) => `${index + 1}. ${step}`),
        ];
        if (plan.verification.length > 0) {
            lines.push('', 'Verification:', ...plan.verification.map((item, index) => `${index + 1}. ${item}`));
        }
        if (plan.risks.length > 0) {
            lines.push('', 'Risks:', ...plan.risks.map((item, index) => `${index + 1}. ${item}`));
        }
        if (plan.files.length > 0) {
            lines.push('', 'Files:', ...plan.files.map((item) => `- ${item}`));
        }
        return lines.join('\n');
    }

    function parseEditableList(lines: string[]): string[] {
        return lines
            .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim())
            .filter(Boolean);
    }

    function parseEditablePlan(text: string, fallback: PlanProposal): PlanProposal {
        const lines = text.split('\n');
        const sections = new Map<string, string[]>();
        let current = '';
        let title = fallback.title;
        let summary = fallback.summary;

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            const field = line.match(/^(Title|Summary):\s*(.+)$/i);
            if (field) {
                if (field[1].toLowerCase() === 'title') title = field[2].trim();
                if (field[1].toLowerCase() === 'summary') summary = field[2].trim();
                continue;
            }
            const section = line.match(/^(Steps|Verification|Risks|Files):\s*$/i);
            if (section) {
                current = section[1].toLowerCase();
                sections.set(current, []);
                continue;
            }
            if (current) {
                sections.get(current)?.push(line);
            }
        }

        return normalizePlanProposal({
            title,
            summary,
            steps: parseEditableList(sections.get('steps') ?? fallback.steps),
            verification: parseEditableList(sections.get('verification') ?? fallback.verification),
            risks: parseEditableList(sections.get('risks') ?? fallback.risks),
            files: parseEditableList(sections.get('files') ?? fallback.files),
        });
    }

    async function promptForPlanExecution(ctx: ExtensionContext): Promise<void> {
        const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join('\n');
        pi.sendMessage(
            {
                customType: 'plan-todo-list',
                content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
                display: true,
            },
            { triggerTurn: false },
        );

        const choice = await ctx.ui.select('Plan mode - what next?', [
            'Execute with auto edits',
            'Execute with manual review',
            'Keep planning',
            'Edit plan',
        ]);

        const firstTodo = todoItems[0];
        formatRepairAttempted = false;

        if (choice?.startsWith('Execute')) {
            planModeEnabled = false;
            executionMode = todoItems.length > 0;
            executionChoice = choice.includes('manual') ? 'manual_review' : 'auto';
            continuationCount = 0;
            noProgressContinuationCount = 0;
            currentAgentProgressCount = 0;
            pendingBlockedCommand = undefined;
            pendingPlan = undefined;
            await enterPhase(ctx, 'execute');
            persistState();

            sendExecutionHandoff(firstTodo);
        } else if (choice === 'Edit plan') {
            const basePlan =
                pendingPlan ??
                normalizePlanProposal({
                    title: 'Plan',
                    summary: 'Edited legacy plan.',
                    steps: todoItems.map((todo) => todo.text),
                });
            const edited = await ctx.ui.editor('Edit plan:', formatEditablePlan(basePlan));
            if (edited?.trim()) {
                pendingPlan = parseEditablePlan(edited, basePlan);
                todoItems = todosFromPlanProposal(pendingPlan);
                persistState();
                await promptForPlanExecution(ctx);
                return;
            }
            persistState();
        } else if (choice === 'Keep planning') {
            const refinement = await ctx.ui.editor('Refine the plan:', '');
            persistState();
            sendRefinementMessage(refinement ?? '');
        } else {
            persistState();
        }
    }

    function requestPlanFormatRepair(): void {
        formatRepairAttempted = true;
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

    async function executeCurrentPlan(ctx: ExtensionContext): Promise<void> {
        if (executionMode) {
            const remaining = remainingTodos();
            if (remaining.length === 0) {
                ctx.ui.notify('Plan execution is already active, but no remaining todos were found.', 'info');
                return;
            }
            continuationCount = 0;
            noProgressContinuationCount = 0;
            currentAgentProgressCount = 0;
            persistState();
            sendExecutionHandoff(remaining[0], 'continue');
            return;
        }

        if (pendingBlockedCommand && todoItems.length === 0) {
            todoItems = [todoFromBlockedCommand(pendingBlockedCommand)];
            planStage = 'plan';
            persistState();
        }

        if (todoItems.length > 0) {
            await promptForPlanExecution(ctx);
            return;
        }

        ctx.ui.notify('No executable plan is available yet. Refine the plan or ask for a <proposed_plan>.', 'warning');
        const refinement = await ctx.ui.editor('Refine the plan:', '');
        sendRefinementMessage(refinement ?? '');
    }

    function updateTaskStatus(update: PlanTaskUpdateInput): TodoItem {
        const taskId = normalizePlanText(update.taskId, 'taskId');
        const status = update.status;
        if (!['pending', 'in_progress', 'completed', 'blocked'].includes(status)) {
            throw new Error('plan_task_update.status must be pending, in_progress, completed, or blocked.');
        }

        const task = todoItems.find((todo) => todo.id === taskId);
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
            currentAgentProgressCount += 1;
            noProgressContinuationCount = 0;
        }
        return task;
    }

    pi.registerTool({
        name: PLAN_PROPOSAL_TOOL,
        label: 'Propose Plan',
        description:
            'Submit a structured implementation plan while Plan Mode is active. This stores tracked steps and asks the user whether to execute them.',
        promptSnippet: 'Submit a structured Plan Mode proposal for implementation or refactor requests.',
        promptGuidelines: [
            'Use propose_plan when Plan Mode needs an executable implementation, fix, refactor, or verification plan.',
            'Do not ask the user to reply yes or no in chat for execution approval; propose_plan will trigger the harness approval UI.',
        ],
        parameters: PLAN_PROPOSAL_PARAMETERS,
        async execute(_toolCallId, params: PlanProposalInput, _signal, _onUpdate, ctx) {
            if (!planModeEnabled) {
                throw new Error('propose_plan can only be used while Plan Mode is active.');
            }

            const plan = normalizePlanProposal(params);
            pendingPlan = plan;
            todoItems = todosFromPlanProposal(plan);
            planStage = 'plan';
            pendingBlockedCommand = undefined;
            formatRepairAttempted = false;
            suppressNextPlanPrompt = true;
            persistState();

            pi.sendMessage(
                {
                    customType: 'plan-proposal',
                    content: formatPlanProposal(plan),
                    display: true,
                    details: plan,
                },
                { triggerTurn: false },
            );

            if (ctx.hasUI) {
                await promptForPlanExecution(ctx);
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: ctx.hasUI
                            ? 'Structured plan submitted to Plan Mode.'
                            : 'Structured plan submitted. Run /execute to approve it.',
                    },
                ],
                details: { plan, todos: todoItems },
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
        async execute(_toolCallId, params: PlanTaskUpdateInput) {
            if (!executionMode) {
                throw new Error('plan_task_update can only be used while executing an approved plan.');
            }
            const task = updateTaskStatus(params);
            persistState();
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

    pi.registerCommand('plan', {
        description: 'Toggle plan mode (read-only exploration)',
        handler: async (_args, ctx) => togglePlanMode(ctx),
    });

    pi.registerCommand('execute', {
        description: 'Confirm and execute the current plan mode handoff',
        handler: async (_args, ctx) => executeCurrentPlan(ctx),
    });

    pi.registerCommand('todos', {
        description: 'Show current plan todo list',
        handler: async (_args, ctx) => {
            if (todoItems.length === 0) {
                ctx.ui.notify('No todos. Create a plan first with /plan', 'info');
                return;
            }
            const list = todoItems
                .map((item, i) => `${i + 1}. ${item.status === 'completed' ? '✓' : item.status === 'blocked' ? '!' : '○'} ${item.id} ${item.text}`)
                .join('\n');
            ctx.ui.notify(`Plan Progress:\n${list}`, 'info');
        },
    });

    pi.registerShortcut(Key.alt('i'), {
        description: 'Toggle plan mode',
        handler: async (ctx) => togglePlanMode(ctx),
    });

    pi.on('tool_call', async (event) => {
        if (!planModeEnabled) return;

        if (isPlanModeWriteTool(event.toolName)) {
            return {
                block: true,
                reason: `Plan mode: ${event.toolName} is disabled. Do not edit files while Plan Mode is active. Stop using write tools and call propose_plan for the requested change, or ask a critical question with questionnaire. Use /execute after the plan is approved.`,
            };
        }

        if (event.toolName !== 'bash') return;

        const command = event.input.command as string;
        if (!isSafeCommand(command)) {
            if (!pendingBlockedCommand) {
                pendingBlockedCommand = {
                    toolName: 'bash',
                    command,
                    text: summarizeCommand(command),
                };
                persistState();
            }
            return {
                block: true,
                reason: `Plan mode: command blocked (not allowlisted). The blocked command was captured by Plan Mode and an execution decision will be offered after this turn. Do not try another write command such as perl, python, sed -i, cp, mv, tee, or shell redirection. Stop using write tools and call propose_plan for the requested change, or ask a critical question with questionnaire.\nCommand: ${command}`,
            };
        }
    });

    pi.on('context', async (event) => {
        return {
            messages: event.messages.filter((m) => {
                const msg = m as AgentMessage & { customType?: string };
                if (msg.customType === 'plan-mode-context' || msg.customType === 'phase-profile-context') return false;
                if (msg.role !== 'user') return true;

                const content = msg.content;
                if (typeof content === 'string') {
                    return !content.includes('[PLAN MODE ACTIVE]') && !content.includes('[PHASE PROFILE]');
                }
                if (Array.isArray(content)) {
                    return !content.some((c) => {
                        const text = c.type === 'text' ? (c as TextContent).text : undefined;
                        return text?.includes('[PLAN MODE ACTIVE]') || text?.includes('[PHASE PROFILE]');
                    });
                }
                return true;
            }),
        };
    });

    pi.on('before_agent_start', async () => {
        const profile = getProfile(config, activePhase);
        const phaseContext = profile.context ? `\n\n[PHASE PROFILE: ${activePhase}]\n${profile.context}` : '';
        const activePlanTools =
            activePhase === 'plan' ? getPlanModeTools(profile).tools : (profile.tools ?? PLAN_MODE_TOOLS);

        if (planModeEnabled) {
            return {
                message: {
                    customType: 'plan-mode-context',
                    content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: ${activePlanTools.join(', ')}
- You CANNOT modify files, repositories, dependencies, services, or external state.
- You CANNOT call edit, write, apply_patch, or any other write-capable tool while Plan Mode is active.
- Bash is restricted to an allowlist of read-only commands.
- If the user asks you to implement, edit, execute, continue, or apply changes while plan mode is active, treat that as a request to plan the execution. Do not attempt to execute it.
- Do not try write-capable shell commands such as perl -pi, python scripts that write files, sed -i, cp, mv, tee, or shell redirection.
- If the user wants to proceed after a plan exists, tell them to run /execute. Do not ask for a yes/no chat reply and do not tell them to apply shell commands manually.

Workflow:
1. Inspect the relevant code using read-only tools.
2. Identify key ambiguities or decisions that affect implementation direction.
3. If there ARE critical open questions:
   - Use the questionnaire tool. Provide 2-4 concrete options plus a "Custom / Other" option.
   - After receiving answers, incorporate the decisions into your approach.
4. If everything is clear, skip asking and proceed directly.

Once the approach is clear for a fix, change, implementation, or refactor request, call propose_plan with:
- title: short title
- summary: brief summary
- steps: ordered implementation steps
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

        if (executionMode && todoItems.length > 0) {
            const remaining = remainingTodos();
            const todoList = remaining.map((t) => `${t.id} [${t.status}] ${t.text}`).join('\n');
            return {
                message: {
                    customType: 'plan-execution-context',
                    content: `[EXECUTING PLAN - Full tool access enabled]

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
        if (!executionMode || todoItems.length === 0) return;
        if (!isAssistantMessage(event.message)) return;

        const text = getTextContent(event.message);
        const completed = markCompletedSteps(text, todoItems);
        if (completed > 0) {
            currentAgentProgressCount += completed;
            noProgressContinuationCount = 0;
            updateStatus(ctx);
        }
        persistState();
    });

    pi.on('agent_end', async (event, ctx) => {
        if (executionMode && todoItems.length > 0) {
            if (todoItems.every((t) => t.status === 'completed')) {
                const completedList = todoItems.map((t) => `~~${t.text}~~`).join('\n');
                pi.sendMessage(
                    { customType: 'plan-complete', content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
                    { triggerTurn: false },
                );
                executionMode = false;
                todoItems = [];
                pendingPlan = undefined;
                continuationCount = 0;
                noProgressContinuationCount = 0;
                currentAgentProgressCount = 0;
                await enterPhase(ctx, 'normal');
                persistState();
                return;
            }

            const remaining = remainingTodos();
            if (todoItems.some((todo) => todo.status === 'blocked')) {
                const blocked = todoItems.filter((todo) => todo.status === 'blocked');
                ctx.ui.notify(
                    `Plan execution paused: ${blocked.length} task(s) blocked. Run /todos for details or /execute to retry.`,
                    'warning',
                );
                currentAgentProgressCount = 0;
                noProgressContinuationCount = 0;
                persistState();
                return;
            }

            if (currentAgentProgressCount === 0) {
                if (noProgressContinuationCount < MAX_NO_PROGRESS_CONTINUATIONS) {
                    noProgressContinuationCount += 1;
                    currentAgentProgressCount = 0;
                    persistState();
                    sendNoProgressContinuation(remaining[0]);
                    return;
                }

                ctx.ui.notify(
                    `Plan execution paused: no task progress was reported after ${MAX_NO_PROGRESS_CONTINUATIONS} retries. Remaining: ${remaining.length}. Run /execute to resume.`,
                    'warning',
                );
                currentAgentProgressCount = 0;
                persistState();
                return;
            }

            if (continuationCount >= MAX_AUTO_CONTINUATIONS) {
                ctx.ui.notify(
                    `Plan execution paused after ${MAX_AUTO_CONTINUATIONS} automatic continuations. Remaining: ${remaining.length}. Run /execute to resume.`,
                    'warning',
                );
                currentAgentProgressCount = 0;
                noProgressContinuationCount = 0;
                persistState();
                return;
            }

            continuationCount += 1;
            noProgressContinuationCount = 0;
            currentAgentProgressCount = 0;
            persistState();
            sendExecutionHandoff(remaining[0], 'continue');
            return;
        }

        if (!planModeEnabled || !ctx.hasUI) return;

        if (suppressNextPlanPrompt) {
            suppressNextPlanPrompt = false;
            persistState();
            return;
        }

        const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
        const lastAssistantText = lastAssistant ? getTextContent(lastAssistant) : '';
        const extracted = lastAssistantText ? extractTodoItems(lastAssistantText) : [];
        if (extracted.length > 0) {
            todoItems = extracted;
            planStage = 'plan';
            pendingBlockedCommand = undefined;
            pendingPlan = undefined;
            formatRepairAttempted = false;
            persistState();
        } else if (pendingBlockedCommand) {
            todoItems = [todoFromBlockedCommand(pendingBlockedCommand)];
            planStage = 'plan';
            persistState();
        } else if (!formatRepairAttempted && hasMalformedPlanSignal(lastAssistantText)) {
            requestPlanFormatRepair();
            return;
        }

        if (todoItems.length === 0) {
            if (formatRepairAttempted) {
                formatRepairAttempted = false;
                persistState();
                ctx.ui.notify(
                    'Plan Mode could not extract executable steps. Refine the plan, run /execute after a plan is available, or exit Plan Mode.',
                    'warning',
                );
                const choice = await ctx.ui.select('Plan format not recognized', [
                    'Refine the plan',
                    'Stay in plan mode',
                    'Exit plan mode',
                ]);
                if (choice === 'Refine the plan') {
                    const refinement = await ctx.ui.editor('Refine the plan:', '');
                    sendRefinementMessage(refinement ?? '');
                } else if (choice === 'Exit plan mode') {
                    planModeEnabled = false;
                    pendingBlockedCommand = undefined;
                    await enterPhase(ctx, 'normal');
                    persistState();
                }
            }
            return;
        }

        await promptForPlanExecution(ctx);
    });

    pi.on('session_start', async (_event, ctx) => {
        if (pi.getFlag('plan') === true) {
            planModeEnabled = true;
            activePhase = 'plan';
        }

        const entries = ctx.sessionManager.getEntries();

        const planModeEntry = entries
            .filter((e: { type: string; customType?: string }) => e.type === 'custom' && e.customType === 'plan-mode')
            .pop() as
            | {
                  data?: {
                      enabled: boolean;
                      todos?: TodoItem[];
                      executing?: boolean;
                      phase?: PhaseName;
                      stage?: 'inspect' | 'plan';
                      pendingBlockedCommand?: PendingBlockedCommand;
                      pendingPlan?: PlanProposal;
                      formatRepairAttempted?: boolean;
                      continuationCount?: number;
                      noProgressContinuationCount?: number;
                      executionChoice?: ExecutionModeChoice;
                  };
              }
            | undefined;

        if (planModeEntry?.data) {
            planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
            todoItems = normalizeStoredTodoItems(planModeEntry.data.todos ?? todoItems);
            executionMode = planModeEntry.data.executing ?? executionMode;
            activePhase = planModeEntry.data.phase ?? (planModeEnabled ? 'plan' : executionMode ? 'execute' : 'normal');
            planStage = planModeEntry.data.stage ?? 'inspect';
            pendingBlockedCommand = planModeEntry.data.pendingBlockedCommand;
            pendingPlan = normalizeStoredPlan(planModeEntry.data.pendingPlan);
            formatRepairAttempted = planModeEntry.data.formatRepairAttempted ?? false;
            continuationCount = planModeEntry.data.continuationCount ?? 0;
            noProgressContinuationCount = planModeEntry.data.noProgressContinuationCount ?? 0;
            executionChoice = planModeEntry.data.executionChoice ?? 'auto';
        }

        const isResume = planModeEntry !== undefined;
        if (isResume && executionMode && todoItems.length > 0) {
            let executeIndex = -1;
            for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i] as { type: string; customType?: string };
                if (entry.customType === 'plan-mode-execute') {
                    executeIndex = i;
                    break;
                }
            }

            const messages: AssistantMessage[] = [];
            for (let i = executeIndex + 1; i < entries.length; i++) {
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
            markCompletedSteps(allText, todoItems);
        }

        await enterPhase(ctx, activePhase);
    });
}
