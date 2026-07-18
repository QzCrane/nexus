import { describe, expect, mock, test } from 'bun:test';
import type { DomainEntry } from '@nexus/contracts';
import {
	createMediaEligibilityCache,
	type EligibilityCachePort,
} from '../src/content/logic/policy-executor/eligibility-cache';

function entry(restricted: boolean, source: DomainEntry['source'] = 'auto'): DomainEntry {
	return {
		domain: 'media.example',
		source,
		probed: true,
		restricted,
	};
}

function port(cached: DomainEntry | null): EligibilityCachePort & {
	mark: ReturnType<typeof mock>;
} {
	return {
		query: mock(async () => ({ entry: cached })),
		mark: mock(async () => undefined),
	};
}

describe('domain media eligibility cache', () => {
	test('reuses a persisted restricted decision without probing again', async () => {
		const cachePort = port(entry(true));
		const cache = createMediaEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('PENDING')).toBe('RESTRICTED');
		expect(await cache.resolve('SAFE')).toBe('RESTRICTED');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});

	test('persists a new definitive decision once', async () => {
		const cachePort = port(null);
		const cache = createMediaEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('PENDING')).toBe('PENDING');
		expect(await cache.resolve('RESTRICTED')).toBe('RESTRICTED');
		expect(await cache.resolve('RESTRICTED')).toBe('RESTRICTED');
		expect(cachePort.mark).toHaveBeenCalledTimes(1);
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', true);
	});

	test('requires live source evidence before reusing a safe-domain hint', async () => {
		const cachePort = port(entry(false));
		const cache = createMediaEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('PENDING')).toBe('PENDING');
		expect(await cache.resolve('SAFE')).toBe('SAFE');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});

	test('moves an automatic safe entry to restricted after acknowledged Capture', async () => {
		const cachePort = port(entry(false));
		const cache = createMediaEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('PENDING')).toBe('PENDING');
		await cache.recordActual('capture', 'active');
		expect(cachePort.mark).toHaveBeenCalledTimes(1);
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', true);
		expect(await cache.resolve('SAFE')).toBe('RESTRICTED');
	});

	test('does not classify transitional or failed processors as acknowledged', async () => {
		const cachePort = port(entry(false));
		const cache = createMediaEligibilityCache('media.example', cachePort);
		await cache.recordActual('capture', 'starting');
		await cache.recordActual('capture', 'error');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});

	test('keeps a manual safe entry authoritative over automatic processor classification', async () => {
		const cachePort = port(entry(false, 'user'));
		const cache = createMediaEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('RESTRICTED')).toBe('SAFE');
		await cache.recordActual('capture', 'active');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});
});
