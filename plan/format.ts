import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, TextContent } from '@earendil-works/pi-ai';
import type { PlanProposal, PlanProposalInput } from './types.js';
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

export function normalizePlanText(text: unknown, field: string): string {
	if (typeof text !== 'string' || text.trim().length === 0) {
		throw new Error(`${field} must be a non-empty string.`);
	}
	const normalized = text.trim();
	if (/[\r\n]/.test(normalized)) {
		throw new Error(`${field} must be a single-line string.`);
	}
	return normalized;
}

export function normalizePlanSummary(summary: unknown): string {
	if (typeof summary !== 'string' || summary.trim().length === 0) {
		throw new Error('summary must be a non-empty string.');
	}
	return summary.trim().replace(/\s*[\r\n]+\s*/g, ' ');
}

export function normalizePlanList(values: unknown, field: string, required: boolean): string[] {
	if (values === undefined && !required) return [];
	if (!Array.isArray(values)) {
		throw new Error(`${field} must be an array of strings.`);
	}
	const normalized = values
		.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
		.map((value, index) => {
			const trimmed = value.trim();
			if (/[\r\n]/.test(trimmed)) {
				throw new Error(`${field}[${index}] must be a single-line string.`);
			}
			return trimmed;
		});
	if (required && normalized.length === 0) {
		throw new Error(`${field} must contain at least one item.`);
	}
	return normalized;
}

export function normalizePlanProposal(params: PlanProposalInput): PlanProposal {
	return {
		title: normalizePlanText(params.title, 'title'),
		summary: normalizePlanSummary(params.summary),
		steps: normalizePlanList(params.steps, 'steps', true),
		assumptions: normalizePlanList(params.assumptions, 'assumptions', false),
		verification: normalizePlanList(params.verification, 'verification', false),
		risks: normalizePlanList(params.risks, 'risks', false),
		files: normalizePlanList(params.files, 'files', false),
		references: normalizePlanList(params.references, 'references', false),
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
	const references =
		plan.references.length > 0
			? `\n\n**References**\n${plan.references.map((ref, index) => `${index + 1}. ${ref}`).join('\n')}`
			: '';
	return `**${plan.title}**\n\n${plan.summary}\n\n**Plan Steps (${plan.steps.length})**\n${steps}${assumptions}${verification}${risks}${files}${references}`;
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
	const references =
		plan.references.length > 0 ? `\nReferences:\n${plan.references.map((ref) => `- ${ref}`).join('\n')}` : '';
	return `\n\nApproved plan context:
Title: ${plan.title}
Summary: ${plan.summary}${assumptions}${verification}${risks}${files}${references}`;
}

export function formatEditablePlan(plan: PlanProposal): string {
	return [
		`Title: ${plan.title}`,
		`Summary: ${plan.summary}`,
		'',
		'Steps:',
		...plan.steps.map((step, index) => `${index + 1}. ${step}`),
		'',
		'Assumptions:',
		...plan.assumptions.map((item, index) => `${index + 1}. ${item}`),
		'',
		'Verification:',
		...plan.verification.map((item, index) => `${index + 1}. ${item}`),
		'',
		'Risks:',
		...plan.risks.map((item, index) => `${index + 1}. ${item}`),
		'',
		'Files:',
		...plan.files.map((item) => `- ${item}`),
		'',
		'References:',
		...plan.references.map((ref) => `- ${ref}`),
	].join('\n');
}

export function parseEditableList(lines: string[]): string[] {
	return lines
		.map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim())
		.filter(Boolean);
}

export function parseEditablePlan(text: string): PlanProposal {
	const lines = text.split('\n');
	const sections = new Map<string, string[]>();
	let current = '';
	let title: string | undefined;
	let summary: string | undefined;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) continue;
		const field = line.match(/^(Title|Summary):\s*(.+)$/i);
		if (field) {
			if (field[1].toLowerCase() === 'title') title = field[2].trim();
			if (field[1].toLowerCase() === 'summary') summary = field[2].trim();
			continue;
		}
		const section = line.match(/^(Steps|Assumptions|Verification|Risks|Files|References):\s*$/i);
		if (section) {
			current = section[1].toLowerCase();
			sections.set(current, []);
			continue;
		}
		if (current) {
			sections.get(current)?.push(line);
		}
	}

	if (!title) throw new Error('Title is required.');
	if (!summary) throw new Error('Summary is required.');

	return normalizePlanProposal({
		title,
		summary,
		steps: parseEditableList(sections.get('steps') ?? []),
		assumptions: parseEditableList(sections.get('assumptions') ?? []),
		verification: parseEditableList(sections.get('verification') ?? []),
		risks: parseEditableList(sections.get('risks') ?? []),
		files: parseEditableList(sections.get('files') ?? []),
		references: parseEditableList(sections.get('references') ?? []),
	});
}

/**
 * Normalize a single step label for fingerprint matching across plan revisions.
 * Lowercases and collapses whitespace so reordered/re-added steps reuse the same id.
 */
export function fingerprintStep(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Replace the whole approved plan with a living-plan update (Codex `update_plan`).
 *
 * Existing task ids are reused by matching normalized step text, so the agent
 * can add, remove, reorder, or split steps without losing stable ids. Brand-new
 * step text gets the next available task-N id. Step numbers are resequenced to
 * the new order.
 */
export function livingPlanFromUpdate(
	current: TodoItem[],
	incoming: Array<{ step: string; status: import('./types.js').TaskStatus }>,
): TodoItem[] {
	const byText = new Map<string, TodoItem>();
	for (const todo of current) byText.set(fingerprintStep(todo.text), todo);
	let nextId = current.reduce((max, todo) => {
		const n = Number(todo.id.replace(/^task-/, ''));
		return Number.isFinite(n) ? Math.max(max, n) : max;
	}, 0);

	return incoming.map((item, index) => {
		const text = normalizePlanText(item.step, 'step');
		const existing = byText.get(fingerprintStep(text));
		const id = existing?.id ?? `task-${++nextId}`;
		return {
			id,
			step: index + 1,
			text,
			completed: item.status === 'completed',
			status: item.status,
			source: 'plan' as const,
		};
	});
}
