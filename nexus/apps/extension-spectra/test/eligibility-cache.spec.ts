import { describe, expect, mock, test } from 'bun:test';
import type { MediaProcessingRoute, MediaRouteDecision } from '@nexus/contracts';
import {
	createSiteEligibilityCache,
	type EligibilityCachePort,
} from '../src/content/logic/policy-executor/eligibility-cache';

function decision(
	mediaRoute: MediaProcessingRoute | 'auto',
	source: MediaRouteDecision['source'] = mediaRoute === 'auto' ? null : 'auto',
): MediaRouteDecision {
	return { mediaRoute, source };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

function port(initial: MediaRouteDecision = decision('auto')): EligibilityCachePort & {
	get: ReturnType<typeof mock>;
	mark: ReturnType<typeof mock>;
} {
	let stored = { ...initial };
	return {
		get: mock(async () => ({ ...stored })),
		mark: mock(async (
			route: MediaProcessingRoute,
			options: { force?: boolean } = {},
		) => {
			if (!options.force && stored.source === 'user') {
				return { ...stored };
			}
			stored = decision(route, 'auto');
			return { ...stored };
		}),
	};
}

describe('automatic site route cache', () => {
	test('persists current-document evidence without turning it into a hard route pin', async () => {
		const cachePort = port();
		const cache = createSiteEligibilityCache('auto', cachePort);
		expect(await cache.resolve('PENDING')).toBe('PENDING');
		expect(await cache.resolve('SAFE')).toBe('SAFE');
		expect(await cache.resolve('SAFE')).toBe('SAFE');
		expect(cache.getUserRoute()).toBe('auto');
		expect(cachePort.mark).toHaveBeenCalledTimes(1);
		expect(cachePort.mark).toHaveBeenCalledWith('direct', {});
		expect(await cache.resolve('PENDING')).toBe('PENDING');
	});

	test('lets live evidence correct auto records while preserving user choices', async () => {
		const automaticPort = port(decision('capture'));
		const automatic = createSiteEligibilityCache('capture', automaticPort);
		expect(await automatic.resolve('SAFE')).toBe('SAFE');
		expect(automatic.getUserRoute()).toBe('auto');
		expect(automaticPort.mark).toHaveBeenCalledWith(
			'direct',
			{},
		);

		const userPort = port(decision('capture', 'user'));
		const user = createSiteEligibilityCache('capture', userPort);
		expect(await user.resolve('SAFE')).toBe('RESTRICTED');
		expect(user.getUserRoute()).toBe('capture');
		await user.recordActual('webaudio', 'active');
		expect(userPort.mark).not.toHaveBeenCalled();
	});

	test('records only acknowledged active processors and force-corrects a disproven direct pin', async () => {
		const cachePort = port(decision('direct', 'user'));
		const cache = createSiteEligibilityCache('direct', cachePort);
		await cache.recordActual('capture', 'starting');
		await cache.recordActual('capture', 'error');
		expect(cachePort.mark).not.toHaveBeenCalled();
		await cache.recordActual('capture', 'active');
		expect(cachePort.mark).toHaveBeenCalledWith(
			'capture',
			{ force: true },
		);
		// The durable automatic correction is visible in the route list, but it
		// does not become a user-style hard pin over a later document's evidence.
		expect(await cache.resolve('PENDING')).toBe('PENDING');
	});

	test('refreshes an externally changed route without recreating the document cache', async () => {
		const cachePort = port(decision('direct', 'user'));
		const cache = createSiteEligibilityCache('direct', cachePort);
		expect(await cache.resolve('PENDING')).toBe('SAFE');
		expect(cache.getUserRoute()).toBe('direct');
		cachePort.mark.mockImplementationOnce(async () => {
			throw new Error('not used');
		});
		cachePort.get.mockResolvedValueOnce(decision('capture', 'user'));
		expect(await cache.refresh()).toBe('capture');
		expect(cache.getUserRoute()).toBe('capture');
		expect(await cache.resolve('SAFE')).toBe('RESTRICTED');
	});

	test('does not let an older automatic hydration overwrite a newer user path refresh', async () => {
		const oldHydration = deferred<MediaRouteDecision>();
		let reads = 0;
		const cachePort: EligibilityCachePort = {
			get: mock(async () => {
				reads += 1;
				return reads === 1
					? oldHydration.promise
					: decision('capture', 'user');
			}),
			mark: mock(async () => decision('direct')),
		};
		const cache = createSiteEligibilityCache('auto', cachePort);

		expect(await cache.refresh()).toBe('capture');
		expect(cache.getUserRoute()).toBe('capture');
		oldHydration.resolve(decision('direct', 'auto'));
		await Promise.resolve();
		await Promise.resolve();

		expect(cache.getUserRoute()).toBe('capture');
	});
});
