/**
 * LLM-facing response envelope.
 * Forked (精简) from @juicesharp/rpiv-ask-user-question v2.0.0 (MIT).
 *
 * LLM-facing copy stays English by design (reliable model interpretation),
 * matching the upstream contract. User-facing dialog strings localize via i18n.
 */
import type { QuestionAnswer, QuestionParams, QuestionnaireResult } from './types.js';

export const NO_INPUT_PLACEHOLDER = '(no input)';
export const DECLINE_MESSAGE = 'User declined to answer questions';
export const ENVELOPE_PREFIX = 'User has answered your questions:';
export const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";

export function formatAnswerScalar(a: QuestionAnswer): string {
	switch (a.kind) {
		case 'multi':
			return a.selected && a.selected.length > 0 ? a.selected.join(', ') : NO_INPUT_PLACEHOLDER;
		case 'custom':
			return a.answer && a.answer.length > 0 ? a.answer : NO_INPUT_PLACEHOLDER;
		case 'option':
			return a.answer ?? NO_INPUT_PLACEHOLDER;
	}
}

export function buildAnswerSegment(a: QuestionAnswer): string {
	return `"${a.question}"="${formatAnswerScalar(a)}".`;
}

export function buildQuestionnaireResponse(
	result: QuestionnaireResult | null | undefined,
	_params: QuestionParams,
) {
	if (!result || result.cancelled) {
		return buildToolResult(DECLINE_MESSAGE, {
			answers: result?.answers ?? [],
			cancelled: true,
		});
	}
	const segments: string[] = [];
	for (let i = 0; i < _params.questions.length; i++) {
		const a = result.answers.find((x) => x.questionIndex === i);
		if (a) segments.push(buildAnswerSegment(a));
	}
	if (segments.length === 0) {
		return buildToolResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
	}
	return buildToolResult(`${ENVELOPE_PREFIX} ${segments.join(' ')} ${ENVELOPE_SUFFIX}`, result);
}

export function buildToolResult(text: string, details: QuestionnaireResult) {
	return {
		content: [{ type: 'text' as const, text }],
		details,
	};
}
