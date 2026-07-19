import { describe, expect, mock, test } from 'bun:test';
import type { DomainEntry, MediaRoute } from '@nexus/contracts';
import {
	createSiteEligibilityCache,
	type EligibilityCachePort,
} from '../src/content/logic/policy-executor/eligibility-cache';

const siteFingerprint = 'site:media.example';

function entry(
	fingerprint: string,
	route: MediaRoute,
	source: DomainEntry['source'] = 'auto',
): DomainEntry {
	return {
		domain: 'media.example',
		fingerprint,
		route,
		source,
		updatedAt: 1,
	};
}

function port(cached: DomainEntry[] = []): EligibilityCachePort & {
	mark: ReturnType<typeof mock>;
} {
	return {
		query: mock(async (_domain: string, fingerprint: string) => ({
			entry: cached.find((candidate) => candidate.fingerprint === fingerprint) ?? null,
		})),
		mark: mock(async (domain: string, fingerprint: string, route: MediaRoute) => {
			const recorded: DomainEntry = { domain, fingerprint, route, source: 'auto', updatedAt: 2 };
			return { entries: [recorded], entry: recorded, created: true };
		}),
	};
}

describe('site route cache', () => {
	test('reuses a persisted Capture route for an unknown document state', async () => {
		const cachePort = port([entry(siteFingerprint, 'capture')]);
		const cache = createSiteEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('PENDING')).toBe('RESTRICTED');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});

	test('persists a definitive direct route once for the site', async () => {
		const cachePort = port();
		const cache = createSiteEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('PENDING')).toBe('PENDING');
		expect(await cache.resolve('SAFE')).toBe('SAFE');
		expect(await cache.resolve('SAFE')).toBe('SAFE');
		expect(cachePort.mark).toHaveBeenCalledTimes(1);
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', siteFingerprint, 'direct');
	});

	test('uses one site key even as individual videos change', async () => {
		const cachePort = port();
		const cache = createSiteEligibilityCache('media.example', cachePort);
		await cache.resolve('RESTRICTED');
		await cache.resolve('RESTRICTED');
		expect(cachePort.query).toHaveBeenCalledWith('media.example', siteFingerprint);
		expect(cachePort.mark).toHaveBeenCalledTimes(1);
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', siteFingerprint, 'capture');
	});

	test('lets current evidence correct an automatic cached route', async () => {
		const cachePort = port([entry(siteFingerprint, 'capture')]);
		const cache = createSiteEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('SAFE')).toBe('SAFE');
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', siteFingerprint, 'direct');
	});

	test('records acknowledged Capture as the successful on-demand route', async () => {
		const cachePort = port();
		const cache = createSiteEligibilityCache('media.example', cachePort);
		await cache.recordActual('capture', 'active');
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', siteFingerprint, 'capture');
		expect(await cache.resolve('PENDING')).toBe('RESTRICTED');
	});

	test('does not cache transitional or failed processors', async () => {
		const cachePort = port();
		const cache = createSiteEligibilityCache('media.example', cachePort);
		await cache.recordActual('capture', 'starting');
		await cache.recordActual('capture', 'error');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});

	test('keeps a user-pinned direct route authoritative', async () => {
		const cachePort = port([entry(siteFingerprint, 'direct', 'user')]);
		const cache = createSiteEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('RESTRICTED')).toBe('SAFE');
		await cache.recordActual('capture', 'active');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});
});
