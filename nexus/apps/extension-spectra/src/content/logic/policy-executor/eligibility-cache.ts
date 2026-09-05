// goal: learn one bounded direct/capture route per site from current-document
// evidence and acknowledged processor ownership

import type { MediaProcessingRoute, MediaRouteDecision } from '@nexus/contracts';
import { sendSpectraRequest } from '../../../shared/spectra-client';

export type SiteEligibility = 'PENDING' | 'SAFE' | 'RESTRICTED';

export interface EligibilityCachePort {
	get(): Promise<MediaRouteDecision>;
	mark(route: MediaProcessingRoute, options?: { force?: boolean }): Promise<MediaRouteDecision>;
}

const routePort: EligibilityCachePort = {
	async get() {
		const response = await sendSpectraRequest('spectra.audio.route.get', {});
		if (!response.ok) throw response.error;
		return response.data;
	},
	async mark(route, options = {}) {
		const response = await sendSpectraRequest('spectra.audio.route.record', {
			route,
			force: options.force,
		});
		if (!response.ok) throw response.error;
		return response.data;
	},
};

interface SiteDecision {
	cachedStatus: SiteEligibility;
	lastPersistedStatus: SiteEligibility;
	manualStatus: Exclude<SiteEligibility, 'PENDING'> | null;
}

function routeToStatus(route: MediaProcessingRoute): Exclude<SiteEligibility, 'PENDING'> {
	return route === 'capture' ? 'RESTRICTED' : 'SAFE';
}

function statusToRoute(status: Exclude<SiteEligibility, 'PENDING'>): MediaProcessingRoute {
	return status === 'RESTRICTED' ? 'capture' : 'direct';
}

export interface SiteEligibilityCache {
	refresh(): Promise<MediaProcessingRoute | 'auto'>;
	resolve(liveStatus: SiteEligibility): Promise<SiteEligibility>;
	recordActual(
		actualMode: 'bypass' | 'webaudio' | 'capture',
		phase: 'idle' | 'starting' | 'active' | 'stopping' | 'error',
	): Promise<void>;
}

export function createSiteEligibilityCache(
	initialRoute: MediaProcessingRoute | 'auto',
	port: EligibilityCachePort = routePort,
): SiteEligibilityCache {
	const initialStatus = initialRoute === 'auto' ? 'PENDING' : routeToStatus(initialRoute);
	const decision: SiteDecision = {
		cachedStatus: initialStatus,
		lastPersistedStatus: initialStatus,
		// Until the additive sender-bound route RPC resolves, conservatively keep
		// a non-auto route from the stable policy snapshot as a user choice.
		manualStatus: initialStatus === 'PENDING' ? null : initialStatus,
	};

	const refresh = async (): Promise<MediaProcessingRoute | 'auto'> => {
		const current = await port.get();
		if (current.mediaRoute === 'auto') {
			decision.cachedStatus = 'PENDING';
			decision.lastPersistedStatus = 'PENDING';
			decision.manualStatus = null;
			return 'auto';
		}
		const status = routeToStatus(current.mediaRoute);
		decision.cachedStatus = status;
		decision.lastPersistedStatus = status;
		decision.manualStatus = current.source === 'user' ? status : null;
		return current.mediaRoute;
	};

	let hydration = refresh().catch(() => initialRoute);
	const persist = async (
		status: Exclude<SiteEligibility, 'PENDING'>,
		options: { force?: boolean } = {},
	): Promise<void> => {
		if (decision.lastPersistedStatus === status) return;
		if (decision.manualStatus && !options.force) return;
		const previousPersistedStatus = decision.lastPersistedStatus;
		decision.lastPersistedStatus = status;
		try {
			const result = await port.mark(statusToRoute(status), options);
			if (result.mediaRoute === 'auto') {
				decision.lastPersistedStatus = previousPersistedStatus;
				return;
			}
			const committed = routeToStatus(result.mediaRoute);
			decision.cachedStatus = committed;
			decision.lastPersistedStatus = committed;
			decision.manualStatus = result.source === 'user' ? committed : null;
		} catch {
			decision.lastPersistedStatus = previousPersistedStatus;
		}
	};

	return {
		async refresh() {
			hydration = refresh().catch(() => (
				decision.cachedStatus === 'PENDING' ? 'auto' : statusToRoute(decision.cachedStatus)
			));
			return hydration;
		},
		async resolve(liveStatus) {
			await hydration;
			if (decision.manualStatus) return decision.manualStatus;
			// Automatic records are durable evidence for the list and persistence
			// dedupe, not a hard routing pin. Only a user choice can override the
			// current document's PENDING/SAFE/RESTRICTED evidence.
			if (liveStatus === 'PENDING') return liveStatus;
			decision.cachedStatus = liveStatus;
			void persist(liveStatus).catch(() => undefined);
			return liveStatus;
		},
		async recordActual(actualMode, phase) {
			await hydration;
			if (phase !== 'active' || actualMode === 'bypass') return;
			const status = actualMode === 'capture'
				? 'RESTRICTED'
				: 'SAFE';
			if (decision.manualStatus === status) return;
			decision.cachedStatus = status;
			await persist(status, { force: actualMode === 'capture' });
		},
	};
}
