import { describe, expect, test } from 'bun:test';
import { DICT } from '../src/options/i18n-dict';

const UX_KEYS = [
	'invalid_domain',
	'site_exists',
	'delete_site_confirm',
	'delete_site_title',
	'delete_site_action',
	'options_error',
	'options_retry',
	'opt_diagnostics_title',
	'opt_diagnostics_desc',
	'opt_diagnostics_export',
	'opt_diagnostics_collecting',
	'opt_diagnostics_exported',
	'opt_diagnostics_failed',
] as const;

describe('Options user-facing copy', () => {
	test('ships complete localized validation, recovery, confirmation, and diagnostic copy', () => {
		expect(Object.keys(DICT).sort()).toEqual([
			'de-DE',
			'en-US',
			'es-ES',
			'fr-FR',
			'ja-JP',
			'ko-KR',
			'ru-RU',
			'zh-CN',
			'zh-TW',
		]);
		for (const [locale, dictionary] of Object.entries(DICT)) {
			for (const key of UX_KEYS) {
				expect(dictionary[key]?.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
			}
			expect(dictionary.delete_site_confirm, locale).toContain('{domain}');
			if (locale !== 'en-US') {
				expect(dictionary.options_error, locale).not.toBe(DICT['en-US']?.options_error);
				expect(dictionary.opt_diagnostics_failed, locale).not.toBe(DICT['en-US']?.opt_diagnostics_failed);
			}
		}
	});
});
