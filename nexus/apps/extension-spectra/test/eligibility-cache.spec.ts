import { describe, expect, mock, test } from 'bun:test';
import type { DomainEntry, MediaRoute } from '@nexus/contracts';
import {
	createMediaEligibilityCache,
	createMediaRouteFingerprint,
	type EligibilityCachePort,
} from '../src/content/logic/policy-executor/eligibility-cache';

const firstFingerprint = 'media:v1:0123456789abcdef';
const secondFingerprint = 'media:v1:fedcba9876543210';

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

describe('media fingerprint route cache', () => {
	test('reuses a persisted Capture route for the same unknown fingerprint', async () => {
		const cachePort = port([entry(firstFingerprint, 'capture')]);
		const cache = createMediaEligibilityCache('media.example', cachePort);
		expect(await cache.resolve(firstFingerprint, 'PENDING')).toBe('RESTRICTED');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});

	test('persists a definitive direct route once for one fingerprint', async () => {
		const cachePort = port();
		const cache = createMediaEligibilityCache('media.example', cachePort);
		expect(await cache.resolve(firstFingerprint, 'PENDING')).toBe('PENDING');
		expect(await cache.resolve(firstFingerprint, 'SAFE')).toBe('SAFE');
		expect(await cache.resolve(firstFingerprint, 'SAFE')).toBe('SAFE');
		expect(cachePort.mark).toHaveBeenCalledTimes(1);
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', firstFingerprint, 'direct');
	});

	test('keeps two media fingerprints on the same site independent', async () => {
		const cachePort = port([
			entry(firstFingerprint, 'capture'),
			entry(secondFingerprint, 'direct'),
		]);
		const cache = createMediaEligibilityCache('media.example', cachePort);
		expect(await cache.resolve(firstFingerprint, 'PENDING')).toBe('RESTRICTED');
		expect(await cache.resolve(secondFingerprint, 'PENDING')).toBe('SAFE');
	});

	test('lets current evidence correct an automatic cached route', async () => {
		const cachePort = port([entry(firstFingerprint, 'capture')]);
		const cache = createMediaEligibilityCache('media.example', cachePort);
		expect(await cache.resolve(firstFingerprint, 'SAFE')).toBe('SAFE');
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', firstFingerprint, 'direct');
	});

	test('records acknowledged Capture as the successful on-demand route', async () => {
		const cachePort = port();
		const cache = createMediaEligibilityCache('media.example', cachePort);
		await cache.recordActual(firstFingerprint, 'capture', 'active');
		expect(cachePort.mark).toHaveBeenCalledWith('media.example', firstFingerprint, 'capture');
		expect(await cache.resolve(firstFingerprint, 'PENDING')).toBe('RESTRICTED');
	});

	test('does not cache transitional or failed processors', async () => {
		const cachePort = port();
		const cache = createMediaEligibilityCache('media.example', cachePort);
		await cache.recordActual(firstFingerprint, 'capture', 'starting');
		await cache.recordActual(firstFingerprint, 'capture', 'error');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});

	test('keeps a user-pinned direct route authoritative', async () => {
		const cachePort = port([entry(firstFingerprint, 'direct', 'user')]);
		const cache = createMediaEligibilityCache('media.example', cachePort);
		expect(await cache.resolve(firstFingerprint, 'RESTRICTED')).toBe('SAFE');
		await cache.recordActual(firstFingerprint, 'capture', 'active');
		expect(cachePort.mark).not.toHaveBeenCalled();
	});

	test('fingerprints origins and transport shape without retaining media paths', () => {
		const media = (currentSrc: string, crossOrigin = '') => ({
			currentSrc,
			src: currentSrc,
			srcObject: null,
			crossOrigin,
		}) as unknown as HTMLMediaElement;
		const first = createMediaRouteFingerprint('media.example', [
			media('https://cdn.example/video/one.m4s', 'anonymous'),
		]);
		const sameShape = createMediaRouteFingerprint('media.example', [
			media('https://cdn.example/video/two.m4s', 'anonymous'),
		]);
		const otherOrigin = createMediaRouteFingerprint('media.example', [
			media('https://other.example/video/one.m4s', 'anonymous'),
		]);
		expect(first).toBe(sameShape);
		expect(first).not.toBe(otherOrigin);
		expect(first).toMatch(/^media:v1:[a-f0-9]{16}$/);
		expect(first).not.toContain('video');
	});
});
