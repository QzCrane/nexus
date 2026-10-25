// goal: the only owner of media-route storage normalization and read projections

import {
	MAX_SETTINGS_SNAPSHOT_ENTRIES,
	createMediaRouteRuleFingerprint,
	createMediaRouteScopeKey,
	createSiteRouteFingerprint,
	isMediaRouteEntry,
	isMediaRouteSettings,
	normalizeMediaRouteScope,
	parseMediaRouteScopeKey,
	type DomainEntry,
	type MediaRouteEntry,
	type MediaRouteRuleEntry,
	type MediaRouteRulesSnapshot,
	type MediaRouteSettings,
	type RegistrySnapshot,
} from '@nexus/contracts';
import { InvalidSettingsPatchError } from './settings-errors';
import { isRecord } from './settings-value-normalization';

export const MEDIA_ROUTES_KEY = 'siteProcessingRoutes';
export const LEGACY_MEDIA_ROUTE_KEYS = ['mediaRouteRegistry', 'restrictedRegistry', 'userRegistry'] as const;

export function normalizeMediaRoutes(candidate: unknown): MediaRouteSettings {
	const routes: MediaRouteSettings = {};
	const accept = (
		rawDomain: unknown,
		rawEntry: unknown,
		fallbackSource: 'user' | 'auto' = 'user',
		rawPathPrefix?: unknown,
	) => {
		if (typeof rawDomain !== 'string') return;
		const explicitPathPrefix = typeof rawPathPrefix === 'string' ? rawPathPrefix : undefined;
		const scope = explicitPathPrefix !== undefined
			? normalizeMediaRouteScope(rawDomain, explicitPathPrefix)
			: parseMediaRouteScopeKey(rawDomain) ?? normalizeMediaRouteScope(rawDomain);
		const key = scope ? createMediaRouteScopeKey(scope) : null;
		if (!key) return;
		let entry: MediaRouteEntry | null = null;
		if (isMediaRouteEntry(rawEntry)) {
			entry = rawEntry;
		} else if (isRecord(rawEntry)) {
			const route = rawEntry.route === 'direct' || rawEntry.restricted === false ? 'direct'
				: rawEntry.route === 'capture' || rawEntry.restricted === true ? 'capture' : null;
			if (route) {
				entry = {
					route,
					source: rawEntry.source === 'auto' ? 'auto' : fallbackSource,
					updatedAt: Number.isSafeInteger(rawEntry.updatedAt)
						? Number(rawEntry.updatedAt)
						: Number.isSafeInteger(rawEntry.addedAt) ? Number(rawEntry.addedAt) : 0,
				};
			}
		} else if (typeof rawEntry === 'string') {
			entry = { route: 'capture', source: fallbackSource, updatedAt: 0 };
		}
		if (!entry) return;
		const previous = routes[key];
		if (!previous
			|| (entry.source === 'user' && previous.source !== 'user')
			|| (entry.source === previous.source && entry.updatedAt >= previous.updatedAt)) {
			routes[key] = entry;
		}
	};

	if (isMediaRouteSettings(candidate, MAX_SETTINGS_SNAPSHOT_ENTRIES)) {
		for (const [domain, entry] of Object.entries(candidate)) accept(domain, entry);
	} else if (Array.isArray(candidate)) {
		for (const value of candidate) {
			if (typeof value === 'string') accept(value, value);
			else if (isRecord(value)) accept(
				value.domain,
				value,
				value.source === 'auto' ? 'auto' : 'user',
				value.pathPrefix,
			);
		}
	}
	return routes;
}

export function selectMediaRouteStorageValue(values: Record<string, unknown>): unknown {
	if (Object.hasOwn(values, MEDIA_ROUTES_KEY)) return values[MEDIA_ROUTES_KEY];
	for (const key of LEGACY_MEDIA_ROUTE_KEYS) {
		if (Object.hasOwn(values, key)) return values[key];
	}
	return undefined;
}

export function projectMediaRouteEntry(domain: string, entry: MediaRouteEntry): DomainEntry {
	const fingerprint = createSiteRouteFingerprint(domain);
	if (!fingerprint) throw new InvalidSettingsPatchError('Invalid media route hostname');
	return { domain, fingerprint, ...entry };
}

export function projectMediaRouteSnapshot(routes: MediaRouteSettings): RegistrySnapshot {
	return {
		entries: Object.entries(routes)
			.flatMap(([key, entry]) => {
				const scope = parseMediaRouteScopeKey(key);
				return scope && !scope.pathPrefix ? [projectMediaRouteEntry(scope.domain, entry)] : [];
			})
			.sort((left, right) => left.domain.localeCompare(right.domain)),
	};
}

export function projectMediaRouteRulesSnapshot(routes: MediaRouteSettings): MediaRouteRulesSnapshot {
	return {
		entries: Object.entries(routes)
			.flatMap(([key, entry]): MediaRouteRuleEntry[] => {
				const scope = parseMediaRouteScopeKey(key);
				if (!scope) return [];
				const fingerprint = createMediaRouteRuleFingerprint(scope);
				if (!fingerprint) return [];
				return [{
					domain: scope.domain,
					...(scope.pathPrefix ? { pathPrefix: scope.pathPrefix } : {}),
					fingerprint,
					...entry,
				}];
			})
			.sort((left, right) => (
				left.domain.localeCompare(right.domain)
				|| (left.pathPrefix ?? '').localeCompare(right.pathPrefix ?? '')
			)),
	};
}
