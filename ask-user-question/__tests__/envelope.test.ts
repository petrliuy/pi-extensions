import { describe, expect, it } from 'vitest';
import {
	buildAnswerSegment,
	buildQuestionnaireResponse,
	DECLINE_MESSAGE,
	formatAnswerScalar,
	NO_INPUT_PLACEHOLDER,
} from '../envelope.js';
import type { QuestionAnswer, QuestionParams, QuestionnaireResult } from '../types.js';

const params: QuestionParams = {
	questions: [
		{ question: 'Which lib?', header: 'Lib', options: [{ label: 'A', description: 'x' }, { label: 'B', description: 'x' }] },
		{ question: 'Which feature?', header: 'Feat', options: [{ label: 'X', description: 'x' }, { label: 'Y', description: 'x' }] },
	],
};

describe('formatAnswerScalar', () => {
	it('option → label', () => {
		expect(formatAnswerScalar({ questionIndex: 0, question: 'q', kind: 'option', answer: 'A' })).toBe('A');
	});
	it('option null → placeholder', () => {
		expect(formatAnswerScalar({ questionIndex: 0, question: 'q', kind: 'option', answer: null })).toBe(NO_INPUT_PLACEHOLDER);
	});
	it('custom → typed text', () => {
		expect(formatAnswerScalar({ questionIndex: 0, question: 'q', kind: 'custom', answer: 'my own' })).toBe('my own');
	});
	it('custom empty → placeholder', () => {
		expect(formatAnswerScalar({ questionIndex: 0, question: 'q', kind: 'custom', answer: '' })).toBe(NO_INPUT_PLACEHOLDER);
	});
	it('multi → joined labels', () => {
		expect(formatAnswerScalar({ questionIndex: 0, question: 'q', kind: 'multi', answer: null, selected: ['X', 'Y'] })).toBe('X, Y');
	});
	it('multi empty → placeholder', () => {
		expect(formatAnswerScalar({ questionIndex: 0, question: 'q', kind: 'multi', answer: null, selected: [] })).toBe(NO_INPUT_PLACEHOLDER);
	});
});

describe('buildAnswerSegment', () => {
	it('formats Q="A"', () => {
		const a: QuestionAnswer = { questionIndex: 0, question: 'Which lib?', kind: 'option', answer: 'A' };
		expect(buildAnswerSegment(a)).toBe('"Which lib?"="A".');
	});
});

describe('buildQuestionnaireResponse', () => {
	it('returns decline for null/cancelled', () => {
		const r = buildQuestionnaireResponse(null, params);
		expect(r.content[0]!.text).toBe(DECLINE_MESSAGE);
		expect(r.details.cancelled).toBe(true);
		expect(r.details.answers).toEqual([]);
	});

	it('returns decline for cancelled result', () => {
		const result: QuestionnaireResult = { answers: [], cancelled: true };
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0]!.text).toBe(DECLINE_MESSAGE);
		expect(r.details.cancelled).toBe(true);
	});

	it('builds envelope with answer segments', () => {
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [
				{ questionIndex: 0, question: 'Which lib?', kind: 'option', answer: 'A' },
				{ questionIndex: 1, question: 'Which feature?', kind: 'custom', answer: 'both' },
			],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.details.cancelled).toBe(false);
		expect(r.content[0]!.text).toContain('"Which lib?"="A"');
		expect(r.content[0]!.text).toContain('"Which feature?"="both"');
	});

	it('falls back to decline when no answer segments match', () => {
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [{ questionIndex: 99, question: 'other', kind: 'option', answer: 'Z' }],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0]!.text).toBe(DECLINE_MESSAGE);
		expect(r.details.cancelled).toBe(true);
	});
});
