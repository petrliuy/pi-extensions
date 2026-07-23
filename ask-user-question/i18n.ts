/**
 * Bilingual (zh / en) user-facing strings.
 * Forked (精简) from @juicesharp/rpiv-ask-user-question v2.0.0 (MIT), which
 * ships 9 locales via the optional @juicesharp/rpiv-i18n SDK. This fork keeps
 * only zh + en and resolves the locale from the environment directly — no
 * extra dependency, no /languages command, no locale file directory.
 *
 * LLM-facing copy (tool description, schema, envelope, errors) stays English
 * by design; only the in-dialog chrome localizes.
 */

export type Locale = 'zh' | 'en';

interface StringTable {
	customRowLabel: string; // appended to every single-select option list
	customPlaceholder: string; // placeholder for the free-text input
	cancelledNotify: string; // toast when the user abandons the questionnaire
	multiHint: string; // footer hint on the multi-select dialog
	multiTitle: (q: string, header: string) => string; // multi-select dialog heading
}

const STRINGS: Record<Locale, StringTable> = {
	en: {
		customRowLabel: 'Type something.',
		customPlaceholder: 'Your custom answer',
		cancelledNotify: 'Questionnaire cancelled',
		multiHint: 'Space toggle  ·  Enter submit  ·  Esc cancel',
		multiTitle: (q, header) => `[${header}] ${q}`,
	},
	zh: {
		customRowLabel: '输入自定义答案…',
		customPlaceholder: '输入你的答案',
		cancelledNotify: '问卷已取消',
		multiHint: '空格切换  ·  回车提交  ·  Esc 取消',
		multiTitle: (q, header) => `【${header}】${q}`,
	},
};

/** Resolve locale from env, optional config override, then fall back to en. */
export function detectLocale(override?: Locale | string | undefined): Locale {
	const o = normalizeLocale(override);
	if (o) return o;
	for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const) {
		const v = process.env[key];
		if (v) {
			const l = normalizeLocale(v);
			if (l) return l;
		}
	}
	return 'en';
}

function normalizeLocale(v?: string | undefined): Locale | undefined {
	if (!v) return undefined;
	const lower = v.toLowerCase();
	if (lower.startsWith('zh')) return 'zh';
	if (lower.startsWith('en')) return 'en';
	return undefined;
}

export function stringsFor(locale: Locale): StringTable {
	return STRINGS[locale] ?? STRINGS.en;
}
