import { isLocalDiagnosticSender } from '../packages/nexus-kernel/src/diagnostics';
import { describe, expect, test } from 'bun:test';
import {
	assembleLocalDiagnosticBundle,
	createDiagnosticEventBuffer,
} from '../packages/nexus-kernel/src/diagnostics';

describe('local diagnostic privacy contract', () => {
	test('never exports concrete origins, URLs, titles, tokens or storage values', () => {
		const events = createDiagnosticEventBuffer();
		events.record('warn', 'background', 'runtime-retry', 10);
		const bundle = assembleLocalDiagnosticBundle({
			product: 'SPECTRA',
			generatedAt: '2026-08-18T00:00:00.000Z',
			facts: {
				manifestVersion: '1.4.2',
				userAgent: 'Mozilla/5.0 Chrome/135.0.7049.114 Safari/537.36',
				permissions: ['tabs', 'storage', 'tabs', 'bad permission'],
				origins: ['<all_urls>', 'https://private.example/*', 'https://secret.example/*'],
				contextTypes: ['BACKGROUND', 'TAB', 'TAB'],
			},
			owners: {
				visibleMediaTabs: 2,
				offscreenActive: false,
			},
			events: events.read(),
		});
		expect(bundle.permissions).toEqual(['storage', 'tabs']);
		expect(bundle.origins).toEqual({ grantCount: 3, broadGrant: true });
		expect(bundle.contexts).toEqual({ BACKGROUND: 1, TAB: 2 });
		expect(bundle.browser).toEqual({ userAgentFamily: 'Chromium', major: 135 });
		const serialized = JSON.stringify(bundle);
		for (const forbidden of [
			'private.example', 'secret.example', 'https://', 'Mozilla/5.0',
			'url', 'title', 'secret', 'token', 'storageValue',
		]) {
			expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
		}
	});

	test('bounds event history and forbids free-form PII-shaped event tokens', () => {
		const events = createDiagnosticEventBuffer(4);
		for (let index = 0; index < 8; index += 1) {
			events.record('info', 'runtime', `event-${index}`, index);
		}
		expect(events.read().map((event) => event.code)).toEqual(['event-4', 'event-5', 'event-6', 'event-7']);
		expect(() => events.record('error', 'https://example.com', 'boom')).toThrow('bounded non-PII token');
		expect(() => events.record('error', 'runtime', 'user@example.com')).toThrow('bounded non-PII token');
		expect(() => events.record('error', 'runtime', 'title with spaces')).toThrow('bounded non-PII token');
	});

	test('forbids owner summaries from smuggling arbitrary strings', () => {
		expect(() => assembleLocalDiagnosticBundle({
			product: 'HALO',
			generatedAt: '2026-08-18T00:00:00.000Z',
			facts: {
				manifestVersion: '0.6.2',
				userAgent: 'Chrome/135.0.7049.114',
				permissions: [],
				origins: [],
				contextTypes: [],
			},
			owners: { activeTabUrl: 'https://private.example' } as never,
			events: [],
		})).toThrow('must be boolean, finite number or null');
	});
});


test('diagnostics trusts extension pages, including tab-hosted Options, but not content scripts', () => {
	const id = 'abcdefghijklmnopabcdefghijklmnop';
	const url = `chrome-extension://${id}/options.html`;
	expect(isLocalDiagnosticSender({ id, url }, id)).toBe(true);
	expect(isLocalDiagnosticSender({ id, url, origin: `chrome-extension://${id}`, tab: { id: 7 } as chrome.tabs.Tab }, id)).toBe(true);
	for (const sender of [
		undefined, {}, { id }, { id: 'other', url }, { id, url: 'https://example.test/' },
		{ id, url, origin: 'null' }, { id, url: `chrome-extension://${id}.evil/` },
		{ id, url: `chrome-extension://user@${id}/` },
	]) expect(isLocalDiagnosticSender(sender, id)).toBe(false);
});
