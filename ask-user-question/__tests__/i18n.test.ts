import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectLocale, stringsFor } from '../i18n.js';

const ENV_KEYS = ['LC_MESSAGES', 'LC_ALL', 'LANG'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const k of ENV_KEYS) {
		saved[k] = process.env[k];
		delete process.env[k];
	}
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('detectLocale', () => {
	it('override wins over env', () => {
		process.env.LANG = 'zh_CN.UTF-8';
		expect(detectLocale('en')).toBe('en');
	});

	it('zh prefix from LANG → zh', () => {
		process.env.LANG = 'zh_CN.UTF-8';
		expect(detectLocale()).toBe('zh');
	});

	it('en prefix → en', () => {
		process.env.LANG = 'en_US.UTF-8';
		expect(detectLocale()).toBe('en');
	});

	it('LC_MESSAGES takes precedence over LANG', () => {
		process.env.LANG = 'en_US.UTF-8';
		process.env.LC_MESSAGES = 'zh_TW.UTF-8';
		expect(detectLocale()).toBe('zh');
	});

	it('LC_ALL takes precedence over LC_MESSAGES and LANG', () => {
		process.env.LANG = 'en_US.UTF-8';
		process.env.LC_MESSAGES = 'en_US.UTF-8';
		process.env.LC_ALL = 'zh_CN.UTF-8';
		expect(detectLocale()).toBe('zh');
	});

	it('unknown locale → en fallback', () => {
		process.env.LANG = 'fr_FR.UTF-8';
		expect(detectLocale()).toBe('en');
	});

	it('no env → en fallback', () => {
		expect(detectLocale()).toBe('en');
	});
});

describe('stringsFor', () => {
	it('en strings have custom row label', () => {
		expect(stringsFor('en').customRowLabel).toBe('Type something.');
	});

	it('zh strings have Chinese custom row label', () => {
		expect(stringsFor('zh').customRowLabel).toBe('输入自定义答案…');
	});

	it('zh multiTitle uses full-width brackets', () => {
		expect(stringsFor('zh').multiTitle('哪个?', '库')).toBe('【库】哪个?');
	});

	it('falls back to en for unknown locale', () => {
		expect(stringsFor('xx' as never).customRowLabel).toBe('Type something.');
	});
});
