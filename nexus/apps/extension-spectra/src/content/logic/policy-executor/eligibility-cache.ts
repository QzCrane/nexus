// goal: choose one on-demand processing route for each privacy-preserving media fingerprint

import type {
	MediaRoute,
	RegistryAddResult,
	RegistryQueryResult,
} from '@nexus/contracts';
import type { MediaSourceEligibilityEvidence } from '@nexus/audio-engine';
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

export interface MediaEligibilityCache {
	resolve(fingerprint: string, liveStatus: CorsStatus): Promise<CorsStatus>;
	recordActual(
		fingerprint: string,
		actualMode: 'bypass' | 'webaudio' | 'capture',
		phase: 'idle' | 'starting' | 'active' | 'stopping' | 'error',
	): Promise<void>;
}

interface FingerprintDecision {
	cachedStatus: CorsStatus;
	lastPersistedStatus: CorsStatus;
	manualStatus: Exclude<CorsStatus, 'PENDING'> | null;
	hydrated: Promise<void>;
}

function stableHash(input: string): string {
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;
	for (let index = 0; index < input.length; index += 1) {
		const code = input.charCodeAt(index);
		first = Math.imul(first ^ code, 0x01000193);
		second = Math.imul(second ^ code, 0x85ebca6b);
		second ^= second >>> 13;
	}
	return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function resourceShape(element: HTMLMediaElement): string {
	const cors = element.crossOrigin || 'none';
	if (element.srcObject) return `stream|${cors}`;
	const resource = element.currentSrc || element.src || '';
	if (!resource) return `unselected|${cors}`;
	if (resource.startsWith('data:')) return `data|${cors}`;
	try {
		const url = new URL(resource, globalThis.document?.baseURI || globalThis.location?.href);
		const transport = url.protocol === 'blob:' ? `blob:${url.origin}` : `${url.protocol}//${url.host}`;
		return `${transport}|${cors}`;
	} catch {
		return `invalid|${cors}`;
	}
}

// post: hashes only origins/transport classes and CORS mode; complete media URLs never leave the page.
export function createMediaRouteFingerprint(
	domain: string,
	elements: readonly HTMLMediaElement[],
	evidenceFor: (element: HTMLMediaElement) => MediaSourceEligibilityEvidence | undefined = () => undefined,
): string {
	const frameOrigin = (() => {
		try { return globalThis.location?.origin || 'null'; } catch { return 'null'; }
	})();
	const shapes = elements.map((element) => {
		const evidence = evidenceFor(element)?.kind ?? 'none';
		return `${resourceShape(element)}|${evidence}`;
	}).sort();
	return `media:v1:${stableHash([domain, frameOrigin, ...shapes].join('\n'))}`;
}

function routeToStatus(route: MediaRoute): Exclude<CorsStatus, 'PENDING'> {
	return route === 'capture' ? 'RESTRICTED' : 'SAFE';
}

function statusToRoute(status: Exclude<CorsStatus, 'PENDING'>): MediaRoute {
	return status === 'RESTRICTED' ? 'capture' : 'direct';
}

export function createMediaEligibilityCache(
	domain: string,
	port: EligibilityCachePort = registryPort,
): MediaEligibilityCache {
	const decisions = new Map<string, FingerprintDecision>();

	const decisionFor = (fingerprint: string): FingerprintDecision => {
		const existing = decisions.get(fingerprint);
		if (existing) return existing;
		const decision: FingerprintDecision = {
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
		decisions.set(fingerprint, decision);
		return decision;
	};

	const persist = async (
		fingerprint: string,
		decision: FingerprintDecision,
		status: Exclude<CorsStatus, 'PENDING'>,
	): Promise<void> => {
		if (decision.manualStatus || decision.lastPersistedStatus === status) return;
		decision.lastPersistedStatus = status;
		await port.mark(domain, fingerprint, statusToRoute(status)).then((result) => {
			if (result.entry.source === 'user') {
				decision.manualStatus = routeToStatus(result.entry.route);
				decision.cachedStatus = decision.manualStatus;
			}
		}).catch(() => {
			if (decision.lastPersistedStatus === status) decision.lastPersistedStatus = 'PENDING';
		});
	};

	return {
		async resolve(fingerprint, liveStatus) {
			const decision = decisionFor(fingerprint);
			await decision.hydrated;
			if (decision.manualStatus) return decision.manualStatus;
			// Current-document evidence corrects an automatic route. The cache is
			// only consulted while the source is genuinely unselected/unknown.
			if (liveStatus !== 'PENDING') {
				decision.cachedStatus = liveStatus;
				void persist(fingerprint, decision, liveStatus);
				return liveStatus;
			}
			return decision.cachedStatus;
		},
		async recordActual(fingerprint, actualMode, phase) {
			const decision = decisionFor(fingerprint);
			await decision.hydrated;
			if (decision.manualStatus || phase !== 'active') return;
			const status = actualMode === 'capture'
				? 'RESTRICTED'
				: actualMode === 'webaudio'
					? 'SAFE'
					: null;
			if (!status) return;
			// This records the successful route, not a domain-wide capability claim.
			decision.cachedStatus = status;
			await persist(fingerprint, decision, status);
		},
	};
}
