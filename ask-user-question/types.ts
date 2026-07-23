/**
 * ask-user-question — types, constants, and JSON Schema.
 *
 * Forked (精简) from @juicesharp/rpiv-ask-user-question v2.0.0 (MIT).
 * Dropped: typebox dependency (plain JSON Schema, matching the local plan
 * extension convention), preview/notes/submit-tab/RPC walker/reconciler.
 */

export const ASK_USER_QUESTION_TOOL_NAME = 'ask_user_question';

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;

/**
 * Reserved option labels. "Other" is reserved for Claude-Code parity (the
 * model is conditioned to reach for it); the custom-row label is the
 * runtime "type your own" affordance; "Next" is a legacy sentinel kept
 * rejected so authored lists stay unambiguous. Authoring any of these
 * triggers a `reserved_label` runtime guard.
 */
export const RESERVED_LABELS = ['Other', 'Type something.', 'Next'] as const;
export type ReservedLabel = (typeof RESERVED_LABELS)[number];

export interface OptionData {
	label: string;
	description: string;
}

export interface QuestionData {
	question: string;
	header: string;
	options: OptionData[];
	multiSelect?: boolean;
}

export interface QuestionParams {
	questions: QuestionData[];
}

/**
 * Answer-intent discriminated union. `kind` is the single discriminator.
 * - `option`: user picked one author-defined option; `answer` is its label.
 * - `custom`: user typed free-text via the "Type something." row; `answer` is the text or null.
 * - `multi`: user committed multi-select choices; `selected` carries labels; `answer` is null.
 */
export interface QuestionAnswer {
	questionIndex: number;
	question: string;
	kind: 'option' | 'custom' | 'multi';
	answer: string | null;
	selected?: string[];
}

export type QuestionnaireError =
	| 'no_ui'
	| 'no_questions'
	| 'too_many_questions'
	| 'duplicate_question'
	| 'empty_options'
	| 'too_many_options'
	| 'reserved_label'
	| 'duplicate_option_label';

export interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
	error?: QuestionnaireError;
}

/** Plain JSON Schema (no typebox) — matches the local plan extension style. */
export const QuestionParamsSchema = {
	type: 'object',
	properties: {
		questions: {
			type: 'array',
			minItems: 1,
			maxItems: MAX_QUESTIONS,
			description: `Questions to ask the user (1-${MAX_QUESTIONS} questions).`,
			items: {
				type: 'object',
				properties: {
					question: {
						type: 'string',
						description:
							'The complete question to ask. Clear, specific, ending with "?". Example: "Which library should we use for date formatting?"',
					},
					header: {
						type: 'string',
						maxLength: MAX_HEADER_LENGTH,
						description: `MAX ${MAX_HEADER_LENGTH} CHARACTERS — hard limit. Very short chip/tag shown next to the question. Examples: "Auth method", "Library".`,
					},
					options: {
						type: 'array',
						minItems: MIN_OPTIONS,
						maxItems: MAX_OPTIONS,
						description: `The available choices (${MIN_OPTIONS}-${MAX_OPTIONS} options). Each option needs a concise label (1-5 words) and a description. The "Type something." row is appended automatically — do NOT author it.`,
						items: {
							type: 'object',
							properties: {
								label: {
									type: 'string',
									maxLength: MAX_LABEL_LENGTH,
									description: `MAX ${MAX_LABEL_LENGTH} CHARACTERS — hard limit. Display text for this option (1-5 words).`,
								},
								description: {
									type: 'string',
									description:
										'Explanation of what this option means or its trade-offs.',
								},
							},
							required: ['label', 'description'],
							additionalProperties: false,
						},
					},
					multiSelect: {
						type: 'boolean',
						default: false,
						description:
							'Set true to allow multiple selections. Use when choices are not mutually exclusive.',
					},
				},
				required: ['question', 'header', 'options'],
				additionalProperties: false,
			},
		},
	},
	required: ['questions'],
	additionalProperties: false,
} as const;
