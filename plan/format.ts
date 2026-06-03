import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AssistantMessage, TextContent } from '@mariozechner/pi-ai';
import type { PendingBlockedCommand, PlanProposal, PlanProposalInput } from './types.js';
import type { TodoItem } from './utils.js';

export function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === 'assistant' && Array.isArray(m.content);
}

export function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === 'text')
		.map((block) => block.text)
		.join('\n');
}

export function summarizeCommand(command: string): string {
	const summary = command.replace(/\s+/g, ' ').trim();
	if (summary.length <= 50) return summary;
	return `${summary.slice(0, 47)}...`;
}

export function todoFromBlockedCommand(blocked: PendingBlockedCommand): TodoItem {
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

export function normalizePlanText(text: unknown, field: string): string {
	if (typeof text !== 'string' || text.trim().length === 0) {
		throw new Error(`${field} must be a non-empty string.`);
	}
	return text.trim();
}

export function normalizePlanList(values: unknown, field: string, required: boolean): string[] {
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

export function normalizePlanProposal(params: PlanProposalInput): PlanProposal {
	return {
		title: normalizePlanText(params.title, 'title'),
		summary: normalizePlanText(params.summary, 'summary'),
		steps: normalizePlanList(params.steps, 'steps', true),
		assumptions: normalizePlanList(params.assumptions, 'assumptions', false),
		verification: normalizePlanList(params.verification, 'verification', false),
		risks: normalizePlanList(params.risks, 'risks', false),
		files: normalizePlanList(params.files, 'files', false),
	};
}

export function todosFromPlanProposal(plan: PlanProposal): TodoItem[] {
	return plan.steps.map((step, index) => ({
		id: `task-${index + 1}`,
		step: index + 1,
		text: step,
		completed: false,
		status: 'pending',
		source: 'plan',
	}));
}

export function formatTodoLine(todo: TodoItem): string {
	return `${todo.id}. ${todo.text}`;
}

export function formatPlanProposal(plan: PlanProposal): string {
	const steps = plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
	const assumptions =
		plan.assumptions.length > 0
			? `\n\n**Assumptions / Defaults**\n${plan.assumptions.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
			: '';
	const verification =
		plan.verification.length > 0
			? `\n\n**Verification**\n${plan.verification.map((step, index) => `${index + 1}. ${step}`).join('\n')}`
			: '';
	const risks =
		plan.risks.length > 0
			? `\n\n**Risks**\n${plan.risks.map((risk, index) => `${index + 1}. ${risk}`).join('\n')}`
			: '';
	const files = plan.files.length > 0 ? `\n\n**Likely Files**\n${plan.files.join('\n')}` : '';
	return `**${plan.title}**\n\n${plan.summary}\n\n**Plan Steps (${plan.steps.length})**\n${steps}${assumptions}${verification}${risks}${files}`;
}

export function formatApprovedPlanContext(plan: PlanProposal | undefined): string {
	if (!plan) return '';
	const assumptions =
		plan.assumptions.length > 0
			? `\nAssumptions:\n${plan.assumptions.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
			: '';
	const verification =
		plan.verification.length > 0
			? `\nVerification:\n${plan.verification.map((step, index) => `${index + 1}. ${step}`).join('\n')}`
			: '';
	const risks =
		plan.risks.length > 0
			? `\nRisks:\n${plan.risks.map((risk, index) => `${index + 1}. ${risk}`).join('\n')}`
			: '';
	const files = plan.files.length > 0 ? `\nFiles:\n${plan.files.map((file) => `- ${file}`).join('\n')}` : '';
	return `\n\nApproved plan context:
Title: ${plan.title}
Summary: ${plan.summary}${assumptions}${verification}${risks}${files}`;
}

export function formatEditablePlan(plan: PlanProposal): string {
	const lines = [
		`Title: ${plan.title}`,
		`Summary: ${plan.summary}`,
		'',
		'Steps:',
		...plan.steps.map((step, index) => `${index + 1}. ${step}`),
	];
	if (plan.assumptions.length > 0) {
		lines.push('', 'Assumptions:', ...plan.assumptions.map((item, index) => `${index + 1}. ${item}`));
	}
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

export function parseEditableList(lines: string[]): string[] {
	return lines
		.map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim())
		.filter(Boolean);
}

export function parseEditablePlan(text: string, fallback: PlanProposal): PlanProposal {
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
		const section = line.match(/^(Steps|Assumptions|Verification|Risks|Files):\s*$/i);
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
		assumptions: parseEditableList(sections.get('assumptions') ?? fallback.assumptions),
		verification: parseEditableList(sections.get('verification') ?? fallback.verification),
		risks: parseEditableList(sections.get('risks') ?? fallback.risks),
		files: parseEditableList(sections.get('files') ?? fallback.files),
	});
}
