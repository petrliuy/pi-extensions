/**
 * ask-user-question — Pi extension.
 *
 * Forked (精简) from @juicesharp/rpiv-ask-user-question v2.0.0 (MIT, juicesharp).
 * This is an independent, self-contained reimplementation: zero external npm
 * dependencies (no @juicesharp/rpiv-config, rpiv-i18n, or typebox), bilingual
 * zh/en locale resolved from the environment, and a minimal dialog built on
 * pi's built-in ctx.ui.select / ctx.ui.input / ctx.ui.custom primitives.
 *
 * Dropped vs upstream (tracked as deliberate fork differences): preview pane,
 * per-option notes, submit-tab review, 9-locale SDK, RPC dialog walker,
 * reconciler, collapse-key toggle, session-graph prewarm.
 *
 * Registers the `ask_user_question` tool: present 1-4 structured questions,
 * each with 2-4 options plus an auto-appended "Type something." custom row on
 * every single-select question. Returns the user's selections or a decline.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { buildQuestionnaireResponse, buildToolResult } from './envelope.js';
import { runQuestionnaire, type DialogContext } from './dialog.js';
import { detectLocale, stringsFor } from './i18n.js';
import {
	ASK_USER_QUESTION_TOOL_NAME,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	QuestionParamsSchema,
	type QuestionParams,
} from './types.js';
import { validateQuestionnaire } from './validate.js';

const ERROR_NO_UI = 'Error: UI not available (running in non-interactive mode)';

const DEFAULT_PROMPT_SNIPPET = `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`;

const DEFAULT_PROMPT_GUIDELINES: string[] = [
	`Use ask_user_question whenever the user's request is underspecified and you cannot proceed without concrete decisions — up to ${MAX_QUESTIONS} questions per invocation.`,
	`Each question MUST have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option requires a concise label (1-5 words) and a description of the choice or its trade-off. The user can type a custom answer via the automatically appended "Type something." row, or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels — reserved labels are rejected at runtime.`,
	'Set multiSelect: true when multiple answers are valid. If you recommend a specific option, make it first and append "(Recommended)" to its label.',
	'Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.',
];

export default function (pi: ExtensionAPI): void {
	const locale = detectLocale();
	const str = stringsFor(locale);

	pi.registerTool({
		name: ASK_USER_QUESTION_TOOL_NAME,
		label: 'Ask User Question',
		description: [
			'Ask the user one or more structured questions during execution. Use when you need to:',
			'1. Gather user preferences or requirements',
			'2. Clarify ambiguous instructions',
			'3. Get decisions on implementation choices as you work',
			'4. Offer choices about what direction to take',
			'',
			'Usage notes:',
			'- Users type a custom answer via the auto-appended "Type something." row on every single-select question, or press Esc to cancel.',
			'- Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.',
			'- Use multiSelect: true when multiple answers are valid.',
			'- If you recommend a specific option, make it first and add "(Recommended)" to the label.',
		].join('\n'),
		promptSnippet: DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: DEFAULT_PROMPT_GUIDELINES,
		parameters: QuestionParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const typed = params as unknown as QuestionParams;
			if (!ctx.hasUI) {
				return buildToolResult(ERROR_NO_UI, { answers: [], cancelled: true, error: 'no_ui' });
			}
			const validation = validateQuestionnaire(typed);
			if (!validation.ok) {
				return buildToolResult(validation.message, {
					answers: [],
					cancelled: true,
					error: validation.error,
				});
			}
			const dialogCtx: DialogContext = {
				hasUI: ctx.hasUI,
				ui: ctx.ui as unknown as DialogContext['ui'],
			};
			const result = await runQuestionnaire(dialogCtx, typed, str);
			if (result.cancelled) ctx.ui.notify?.(str.cancelledNotify, 'info');
			return buildQuestionnaireResponse(result, typed);
		},
	});
}

export { ASK_USER_QUESTION_TOOL_NAME } from './types.js';
export { detectLocale, stringsFor } from './i18n.js';
export { validateQuestionnaire } from './validate.js';
