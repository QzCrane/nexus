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
	// The mock mirrors the real storage layer's user_override rule so tests
	// exercise the force-overwrite path the same way production does.
	const stored: DomainEntry[] = cached.map((value) => ({ ...value }));
	return {
		query: mock(async (_domain: string, fingerprint: string) => ({
			entry: stored.find((candidate) => candidate.fingerprint === fingerprint) ?? null,
		})),
		mark: mock(async (
			domain: string,
			fingerprint: string,
			route: MediaRoute,
			options: { force?: boolean } = {},
		): Promise<{ entries: DomainEntry[]; entry: DomainEntry; created: boolean }> => {
			const existing = stored.find((candidate) => candidate.fingerprint === fingerprint);
			if (existing) {
				// Automatic observations never overwrite a user-pinned route unless
				// forced (the acknowledged-correction path).
				if (!options.force && existing.source === 'user') {
					return { entries: [...stored], entry: existing, created: false };
				}
				existing.domain = domain;
				existing.source = 'auto';
				existing.route = route;
				existing.updatedAt = 2;
				return { entries: [...stored], entry: existing, created: false };
			}
			const recorded: DomainEntry = { domain, fingerprint, route, source: 'auto', updatedAt: 2 };
			stored.push(recorded);
			return { entries: [...stored], entry: recorded, created: true };
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
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', siteFingerprint, 'direct', {});
	});

	test('uses one site key even as individual videos change', async () => {
		const cachePort = port();
		const cache = createSiteEligibilityCache('media.example', cachePort);
		await cache.resolve('RESTRICTED');
		await cache.resolve('RESTRICTED');
		expect(cachePort.query).toHaveBeenCalledWith('media.example', siteFingerprint);
		expect(cachePort.mark).toHaveBeenCalledTimes(1);
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', siteFingerprint, 'capture', {});
	});

	test('lets current evidence correct an automatic cached route', async () => {
		const cachePort = port([entry(siteFingerprint, 'capture')]);
		const cache = createSiteEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('SAFE')).toBe('SAFE');
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', siteFingerprint, 'direct', {});
	});

	test('records acknowledged Capture as the successful on-demand route', async () => {
		const cachePort = port();
		const cache = createSiteEligibilityCache('media.example', cachePort);
		await cache.recordActual('capture', 'active');
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', siteFingerprint, 'capture', { force: true });
		expect(await cache.resolve('PENDING')).toBe('RESTRICTED');
	});

	test('does not cache transitional or failed processors', async () => {
		const cachePort = port();
		const cache = createSiteEligibilityCache('media.example', cachePort);
		await cache.recordActual('capture', 'starting');
		await cache.recordActual('capture', 'error');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});

	test('keeps a user-pinned direct route authoritative for mode selection but corrects it after acknowledged Capture', async () => {
		const cachePort = port([entry(siteFingerprint, 'direct', 'user')]);
		const cache = createSiteEligibilityCache('media.example', cachePort);
		// resolve still honors the user-pinned direct route when choosing a mode.
		expect(await cache.resolve('RESTRICTED')).toBe('SAFE');
		// rule: when Capture is acknowledged active, the pinned `direct` route
		// is provably wrong (native CORS failed) and must be corrected so the
		// next document skips the futile native attempt.
		await cache.recordActual('capture', 'active');
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', siteFingerprint, 'capture', { force: true });
		// The forced mark clears the in-memory user pin, so subsequent resolve
		// honors the corrected auto capture route instead of the stale pin.
		expect(await cache.resolve('PENDING')).toBe('RESTRICTED');
	});

	test('keeps a user-pinned capture route authoritative after acknowledged WebAudio', async () => {
		const cachePort = port([entry(siteFingerprint, 'capture', 'user')]);
		const cache = createSiteEligibilityCache('media.example', cachePort);
		expect(await cache.resolve('SAFE')).toBe('RESTRICTED');
		// rule: WebAudio success never overwrites a user-pinned Capture choice,
		// because the user may have intentionally chosen Capture (e.g. for a
		// site where WebAudio coverage is fragile).
		await cache.recordActual('webaudio', 'active');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});
});
