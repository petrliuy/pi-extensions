import { describe, expect, it } from 'vitest';
import {
	ERROR_DUPLICATE_OPTION_LABEL,
	ERROR_DUPLICATE_QUESTION,
	ERROR_NO_QUESTIONS,
	ERROR_RESERVED_LABEL,
	ERROR_TOO_FEW_OPTIONS,
	ERROR_TOO_MANY_OPTIONS,
	ERROR_TOO_MANY_QUESTIONS,
	validateQuestionnaire,
} from '../validate.js';
import type { QuestionParams } from '../types.js';

const q = (questions: QuestionParams['questions']): QuestionParams => ({ questions });

describe('validateQuestionnaire', () => {
	it('rejects zero questions', () => {
		const r = validateQuestionnaire(q([]));
		expect(r).toEqual({ ok: false, error: 'no_questions', message: ERROR_NO_QUESTIONS });
	});

	it('rejects more than 4 questions', () => {
		const r = validateQuestionnaire(q([
			{ question: 'Q1?', header: 'h', options: [{ label: 'a', description: 'x' }, { label: 'b', description: 'x' }] },
			{ question: 'Q2?', header: 'h', options: [{ label: 'a', description: 'x' }, { label: 'b', description: 'x' }] },
			{ question: 'Q3?', header: 'h', options: [{ label: 'a', description: 'x' }, { label: 'b', description: 'x' }] },
			{ question: 'Q4?', header: 'h', options: [{ label: 'a', description: 'x' }, { label: 'b', description: 'x' }] },
			{ question: 'Q5?', header: 'h', options: [{ label: 'a', description: 'x' }, { label: 'b', description: 'x' }] },
		]));
		expect(r).toEqual({ ok: false, error: 'too_many_questions', message: ERROR_TOO_MANY_QUESTIONS });
	});

	it('rejects duplicate question text', () => {
		const r = validateQuestionnaire(q([
			{ question: 'Same?', header: 'h', options: [{ label: 'a', description: 'x' }, { label: 'b', description: 'x' }] },
			{ question: 'Same?', header: 'h', options: [{ label: 'c', description: 'x' }, { label: 'd', description: 'x' }] },
		]));
		expect(r).toEqual({ ok: false, error: 'duplicate_question', message: ERROR_DUPLICATE_QUESTION });
	});

	it('rejects fewer than 2 options', () => {
		const r = validateQuestionnaire(q([
			{ question: 'Q?', header: 'h', options: [{ label: 'a', description: 'x' }] },
		]));
		expect(r).toEqual({ ok: false, error: 'empty_options', message: ERROR_TOO_FEW_OPTIONS });
	});

	it('rejects more than 4 options', () => {
		const r = validateQuestionnaire(q([
			{ question: 'Q?', header: 'h', options: [
				{ label: 'a', description: 'x' }, { label: 'b', description: 'x' },
				{ label: 'c', description: 'x' }, { label: 'd', description: 'x' },
				{ label: 'e', description: 'x' },
			] },
		]));
		expect(r).toEqual({ ok: false, error: 'too_many_options', message: ERROR_TOO_MANY_OPTIONS });
	});

	it('rejects reserved labels before duplicate labels', () => {
		const r = validateQuestionnaire(q([
			{ question: 'Q?', header: 'h', options: [
				{ label: 'Other', description: 'x' }, { label: 'Other', description: 'x' },
			] },
		]));
		expect(r).toEqual({ ok: false, error: 'reserved_label', message: ERROR_RESERVED_LABEL });
	});

	it('rejects "Type something." and "Next" as reserved', () => {
		for (const label of ['Type something.', 'Next'] as const) {
			const r = validateQuestionnaire(q([
				{ question: 'Q?', header: 'h', options: [
					{ label, description: 'x' }, { label: 'b', description: 'x' },
				] },
			]));
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error).toBe('reserved_label');
		}
	});

	it('rejects duplicate option labels within a question', () => {
		const r = validateQuestionnaire(q([
			{ question: 'Q?', header: 'h', options: [
				{ label: 'a', description: 'x' }, { label: 'a', description: 'x' },
			] },
		]));
		expect(r).toEqual({ ok: false, error: 'duplicate_option_label', message: ERROR_DUPLICATE_OPTION_LABEL });
	});

	it('accepts a valid single + multi question set', () => {
		const r = validateQuestionnaire(q([
			{ question: 'Which?', header: 'Lib', multiSelect: false, options: [
				{ label: 'A', description: 'x' }, { label: 'B', description: 'x' },
			] },
			{ question: 'Which features?', header: 'Feats', multiSelect: true, options: [
				{ label: 'X', description: 'x' }, { label: 'Y', description: 'x' },
			] },
		]));
		expect(r).toEqual({ ok: true });
	});
});
