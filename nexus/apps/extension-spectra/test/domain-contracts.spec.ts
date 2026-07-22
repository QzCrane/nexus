import { describe, expect, test } from 'bun:test';
import {
	findBestHostnameMatch,
	hostnameMatchesRule,
	isSpectraRequestEnvelope,
	normalizeHostname,
} from '@nexus/contracts';

describe('canonical domain contracts', () => {
	test('normalizes URLs, trailing dots, case, and IDNA', () => {
		expect(normalizeHostname(' HTTPS://BÜCHER.Example./path ')).toBe('xn--bcher-kva.example');
		expect(normalizeHostname('not a domain')).toBeNull();
	});

	test('matches only exact hosts and true subdomains', () => {
		expect(hostnameMatchesRule('example.com', 'example.com')).toBe(true);
		expect(hostnameMatchesRule('media.example.com', 'example.com')).toBe(true);
		expect(hostnameMatchesRule('notexample.com', 'example.com')).toBe(false);
		expect(hostnameMatchesRule('sub.127.0.0.1', '127.0.0.1')).toBe(false);
	});

	test('selects the most-specific matching rule', () => {
		const rules = ['example.com', 'video.example.com'];
		expect(findBestHostnameMatch('cdn.video.example.com', rules, (rule) => rule)).toBe('video.example.com');
	});
});

describe('SPECTRA v2 runtime boundary', () => {
	test('accepts a valid settings request and rejects malformed payloads', () => {
		expect(isSpectraRequestEnvelope({
			protocolVersion: 2,
			requestId: 'request-1',
			type: 'spectra.settings.patch',
			payload: {
				expectedRevision: 1,
				patch: { scope: 'global', changes: { themeMode: 'dark' } },
			},
		})).toBe(true);

		expect(isSpectraRequestEnvelope({
			protocolVersion: 2,
			requestId: 'request-2',
			type: 'spectra.settings.patch',
			payload: {
				expectedRevision: -1,
				patch: { scope: 'global', changes: { unknown: true } },
			},
		})).toBe(false);
	});
});
