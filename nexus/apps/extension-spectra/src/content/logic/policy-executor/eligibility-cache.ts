// goal: reuse persisted restricted-domain decisions without treating a domain-level
// safe marker as proof that every newly discovered media resource is WebAudio-safe

import type { RegistryQueryResult } from '@nexus/contracts';
import {
	markRegistryDomainProbed,
	queryRegistryDomain,
} from '../../../shared/registry-client';
import type { CorsStatus } from './types';

export interface EligibilityCachePort {
	query(domain: string): Promise<RegistryQueryResult>;
	mark(domain: string, restricted: boolean): Promise<unknown>;
}

const registryPort: EligibilityCachePort = {
	query: queryRegistryDomain,
	mark: markRegistryDomainProbed,
};

export interface MediaEligibilityCache {
	resolve(liveStatus: CorsStatus): Promise<CorsStatus>;
	recordActual(
		actualMode: 'bypass' | 'webaudio' | 'capture',
		phase: 'idle' | 'starting' | 'active' | 'stopping' | 'error',
	): Promise<void>;
}

export function createMediaEligibilityCache(
	domain: string,
	port: EligibilityCachePort = registryPort,
): MediaEligibilityCache {
	let cachedStatus: CorsStatus = 'PENDING';
	let lastPersistedStatus: CorsStatus = 'PENDING';
	let manualStatus: Exclude<CorsStatus, 'PENDING'> | null = null;
	const hydrated = port.query(domain)
		.then(({ entry }) => {
			if (entry?.restricted === true) cachedStatus = 'RESTRICTED';
			else if (entry?.restricted === false) cachedStatus = 'SAFE';
			if (entry?.source === 'user' && cachedStatus !== 'PENDING') {
				manualStatus = cachedStatus;
			}
			lastPersistedStatus = cachedStatus;
		})
		.catch(() => undefined);

	const persist = async (status: Exclude<CorsStatus, 'PENDING'>): Promise<void> => {
		if (manualStatus || lastPersistedStatus === status) return;
		lastPersistedStatus = status;
		await port.mark(domain, status === 'RESTRICTED').then(() => undefined).catch(() => {
			if (lastPersistedStatus === status) lastPersistedStatus = 'PENDING';
		});
	};

	return {
		async resolve(liveStatus) {
			await hydrated;
			// User categorization is an explicit policy override. Automatic probing
			// must never rewrite a manually chosen safe/restricted entry.
			if (manualStatus) return manualStatus;
			// A restricted decision is domain-wide and reusable. A safe decision is
			// only a hint: a new cross-origin media resource must still provide its
			// own eligibility evidence before MediaElementSource binding.
			if (cachedStatus === 'RESTRICTED') return 'RESTRICTED';
			if (liveStatus === 'PENDING') return 'PENDING';
			cachedStatus = liveStatus;
			void persist(liveStatus);
			return liveStatus;
		},
		async recordActual(actualMode, phase) {
			await hydrated;
			if (manualStatus || phase !== 'active') return;
			const status = actualMode === 'capture'
				? 'RESTRICTED'
				: actualMode === 'webaudio'
					? 'SAFE'
					: null;
			if (!status) return;
			// The registry labels describe the processor path the site actually
			// needs. An acknowledged Capture must never remain visible as SAFE.
			cachedStatus = status;
			await persist(status);
		},
	};
}
