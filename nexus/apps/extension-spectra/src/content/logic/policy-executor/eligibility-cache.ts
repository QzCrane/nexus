// goal: learn one bounded direct/capture route for each site, never for each video instance

import {
	createSiteRouteFingerprint,
	type MediaRoute,
	type RegistryAddResult,
	type RegistryQueryResult,
} from '@nexus/contracts';
import {
	markRegistryDomainProbed,
	queryRegistryDomain,
} from '../../../shared/registry-client';
import type { CorsStatus } from './types';

export interface EligibilityCachePort {
	query(domain: string, fingerprint: string): Promise<RegistryQueryResult>;
	mark(domain: string, fingerprint: string, route: MediaRoute): Promise<RegistryAddResult>;
}

const registryPort: EligibilityCachePort = {
	query: queryRegistryDomain,
	mark: markRegistryDomainProbed,
};

export interface SiteEligibilityCache {
	resolve(liveStatus: CorsStatus): Promise<CorsStatus>;
	recordActual(
		actualMode: 'bypass' | 'webaudio' | 'capture',
		phase: 'idle' | 'starting' | 'active' | 'stopping' | 'error',
	): Promise<void>;
}

interface SiteDecision {
	cachedStatus: CorsStatus;
	lastPersistedStatus: CorsStatus;
	manualStatus: Exclude<CorsStatus, 'PENDING'> | null;
	hydrated: Promise<void>;
}

function routeToStatus(route: MediaRoute): Exclude<CorsStatus, 'PENDING'> {
	return route === 'capture' ? 'RESTRICTED' : 'SAFE';
}

function statusToRoute(status: Exclude<CorsStatus, 'PENDING'>): MediaRoute {
	return status === 'RESTRICTED' ? 'capture' : 'direct';
}

export function createSiteEligibilityCache(
	domain: string,
	port: EligibilityCachePort = registryPort,
): SiteEligibilityCache {
	const fingerprint = createSiteRouteFingerprint(domain);
	if (!fingerprint) throw new Error('Invalid site eligibility domain');
	const decision: SiteDecision = {
		cachedStatus: 'PENDING',
		lastPersistedStatus: 'PENDING',
		manualStatus: null,
		hydrated: Promise.resolve(),
	};
	decision.hydrated = port.query(domain, fingerprint)
		.then(({ entry }) => {
			if (!entry) return;
			decision.cachedStatus = routeToStatus(entry.route);
			decision.lastPersistedStatus = decision.cachedStatus;
			if (entry.source === 'user') decision.manualStatus = decision.cachedStatus;
		})
		.catch(() => undefined);

	const persist = async (
		currentDecision: SiteDecision,
		status: Exclude<CorsStatus, 'PENDING'>,
	): Promise<void> => {
		if (currentDecision.manualStatus || currentDecision.lastPersistedStatus === status) return;
		currentDecision.lastPersistedStatus = status;
		await port.mark(domain, fingerprint, statusToRoute(status)).then((result) => {
			if (result.entry.source === 'user') {
				currentDecision.manualStatus = routeToStatus(result.entry.route);
				currentDecision.cachedStatus = currentDecision.manualStatus;
			}
		}).catch(() => {
			if (currentDecision.lastPersistedStatus === status) currentDecision.lastPersistedStatus = 'PENDING';
		});
	};

	return {
		async resolve(liveStatus) {
			await decision.hydrated;
			if (decision.manualStatus) return decision.manualStatus;
			// Current-document evidence corrects the automatic site route. The
			// persisted decision is only used while the current document is unknown.
			if (liveStatus !== 'PENDING') {
				decision.cachedStatus = liveStatus;
				void persist(decision, liveStatus);
				return liveStatus;
			}
			return decision.cachedStatus;
		},
		async recordActual(actualMode, phase) {
			await decision.hydrated;
			if (decision.manualStatus || phase !== 'active') return;
			const status = actualMode === 'capture'
				? 'RESTRICTED'
				: actualMode === 'webaudio'
					? 'SAFE'
					: null;
			if (!status) return;
			// This records the acknowledged site route, never a media-instance event.
			decision.cachedStatus = status;
			await persist(decision, status);
		},
	};
}
