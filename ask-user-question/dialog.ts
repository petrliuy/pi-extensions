/**
 * Dialog runner — drives the questionnaire via pi's built-in UI primitives.
 * Forked (精简) from @juicesharp/rpiv-ask-user-question v2.0.0 (MIT).
 *
 * Design (vs upstream):
 * - Single-select + custom "Type something." fallback use only ctx.ui.select
 *   and ctx.ui.input — the same primitives the local plan extension trusts.
 *   These also work in RPC mode (select/input sub-protocol), so no separate
 *   RPC walker is needed.
 * - Multi-select uses ctx.ui.custom with a minimal inline MultiSelect
 *   component (Space toggle, Enter submit, Esc cancel). No preview pane,
 *   no per-option notes, no submit tab.
 * - Esc at any primitive resolves undefined and cancels the whole问卷.
 *
 * LLM-facing envelope is built by envelope.ts; this module only collects a
 * QuestionnaireResult.
 */
import { Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import type { QuestionAnswer, QuestionData, QuestionParams, QuestionnaireResult } from './types.js';
import type { StringTable } from './i18n.js';

export interface DialogContext {
	hasUI: boolean;
	ui: {
		select: (title: string, options: string[], opts?: { signal?: AbortSignal }) => Promise<string | undefined>;
		input: (title: string, placeholder: string, opts?: { signal?: AbortSignal }) => Promise<string | undefined>;
		custom: <T>(
			factory: (
				tui: { requestRender: () => void },
				theme: unknown,
				keybindings: unknown,
				done: (value: T | null) => void,
			) => {
				render: (width: number) => string[];
				handleInput: (data: string) => void;
				invalidate: () => void;
			},
			options?: { overlay?: boolean },
		) => Promise<T | undefined>;
		notify?: (message: string, type?: 'info' | 'warning' | 'error') => void;
	};
}

/** Minimal checkbox-list component for multi-select. */
class MultiSelect {
	private items: { label: string; description: string }[];
	private checked: boolean[];
	private cursor = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private hint: string;

	onSubmit?: (selected: string[]) => void;
	onCancel?: () => void;

	constructor(items: { label: string; description: string }[], hint: string) {
		this.items = items;
		this.checked = new Array(items.length).fill(false);
		this.hint = hint;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up) && this.cursor > 0) {
			this.cursor--;
			this.invalidate();
		} else if (matchesKey(data, Key.down) && this.cursor < this.items.length - 1) {
			this.cursor++;
			this.invalidate();
		} else if (matchesKey(data, Key.space)) {
			this.checked[this.cursor] = !this.checked[this.cursor];
			this.invalidate();
		} else if (matchesKey(data, Key.enter)) {
			const selected = this.items.filter((_, i) => this.checked[i]).map((it) => it.label);
			this.onSubmit?.(selected);
		} else if (matchesKey(data, Key.escape)) {
			this.onCancel?.();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const lines = this.items.map((it, i) => {
			const box = this.checked[i] ? '[x] ' : '[ ] ';
			const cur = i === this.cursor ? '> ' : '  ';
			const desc = it.description ? `  — ${it.description}` : '';
			return truncateToWidth(`${cur}${box}${it.label}${desc}`, width);
		});
		lines.push('', truncateToWidth(this.hint, width));
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

export async function runQuestionnaire(
	ctx: DialogContext,
	params: QuestionParams,
	str: StringTable,
): Promise<QuestionnaireResult> {
	const answers: QuestionAnswer[] = [];
	for (let i = 0; i < params.questions.length; i++) {
		const q = params.questions[i]!;
		if (q.multiSelect) {
			const selected = await askMulti(ctx, q, str);
			if (selected === null) {
				return { answers, cancelled: true };
			}
			answers.push({ questionIndex: i, question: q.question, kind: 'multi', answer: null, selected });
		} else {
			const answer = await askSingle(ctx, q, i, str);
			if (answer === null) {
				return { answers, cancelled: true };
			}
			answers.push(answer);
		}
	}
	return { answers, cancelled: false };
}

async function askSingle(
	ctx: DialogContext,
	q: QuestionData,
	index: number,
	str: StringTable,
): Promise<QuestionAnswer | null> {
	const labels = q.options.map((o) => o.label);
	labels.push(str.customRowLabel);
	const title = `[${q.header}] ${q.question}`;
	const picked = await ctx.ui.select(title, labels);
	if (picked === undefined) return null; // Esc
	if (picked === str.customRowLabel) {
		const typed = await ctx.ui.input(q.question, str.customPlaceholder);
		if (typed === undefined) return null; // Esc
		return { questionIndex: index, question: q.question, kind: 'custom', answer: typed };
	}
	return { questionIndex: index, question: q.question, kind: 'option', answer: picked };
}

async function askMulti(
	ctx: DialogContext,
	q: QuestionData,
	str: StringTable,
): Promise<string[] | null> {
	const title = str.multiTitle(q.question, q.header);
	const result = await ctx.ui.custom<string[] | null>(
		(_tui, _theme, _kb, done) => {
			const ms = new MultiSelect(q.options, str.multiHint);
			ms.onSubmit = (sel) => done(sel);
			ms.onCancel = () => done(null);
			return {
				render: (width) => ms.render(width),
				handleInput: (data) => ms.handleInput(data),
				invalidate: () => ms.invalidate(),
			};
		},
		{ overlay: true },
	);
	if (result === undefined || result === null) return null;
	return result;
}
