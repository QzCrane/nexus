// goal: own one explicit direct/capture processing route per normalized site

import { hostnameMatchesRule, normalizeHostname } from './domain.contracts.js';
import { keySetOf } from './key-set.js';

export type MediaProcessingRoute = 'direct' | 'capture';
export type MediaRouteSource = 'user' | 'auto';

// Stable v2 wire names retained for the site-route RPC. The canonical storage
// owner uses MediaRouteEntry; the wire projection carries the normalized domain
// and site fingerprint so old and new extension contexts can interoperate.
export type MediaRoute = MediaProcessingRoute;
export type DomainSource = MediaRouteSource;

export interface MediaRouteEntry {
	route: MediaProcessingRoute;
	source: MediaRouteSource;
	updatedAt: number;
}

export interface MediaRouteScope {
	domain: string;
	pathPrefix?: string;
}

export type MediaRouteSettings = Record<string, MediaRouteEntry>;

export interface DomainEntry extends MediaRouteEntry {
	domain: string;
	fingerprint: string;
}

export interface RegistrySnapshot {
	entries: DomainEntry[];
}

export interface RegistryAddResult extends RegistrySnapshot {
	entry: DomainEntry;
	created: boolean;
}

export interface RegistryRemoveResult extends RegistrySnapshot {
	removed: boolean;
}

export interface RegistryQueryResult {
	entry: DomainEntry | null;
}

export interface RegistryAddPayload {
	domain: string;
	route: MediaRoute;
	force?: boolean;
}

export interface RegistryRemovePayload {
	fingerprint: string;
}

export interface RegistryQueryPayload extends RegistryRemovePayload {
	domain: string;
}

export interface RegistryRecordPayload extends RegistryQueryPayload {
	route: MediaRoute;
	force?: boolean;
}

export interface MediaRouteRuleEntry extends DomainEntry {
	pathPrefix?: string;
}

export interface MediaRouteRulesSnapshot {
	entries: MediaRouteRuleEntry[];
}

export interface MediaRouteRuleUpsertPayload extends MediaRouteScope {
	route: MediaRoute;
}

export interface MediaRouteChangedEvent {
	domain: string;
	mediaRoute: MediaProcessingRoute | 'auto';
}

/** Sender-bound Content projection. Background derives the site from the
 * message sender, so page code cannot read or mutate another hostname. */
export interface MediaRouteDecision {
	mediaRoute: MediaProcessingRoute | 'auto';
	source: MediaRouteSource | null;
}

export interface MediaRouteRecordRequest {
	route: MediaProcessingRoute;
	force?: boolean;
}

const MEDIA_ROUTE_ENTRY_KEYS = /* @__PURE__ */ keySetOf<MediaRouteEntry>()([
	'route',
	'source',
	'updatedAt',
]);
const MEDIA_ROUTE_RULE_ENTRY_KEYS = /* @__PURE__ */ keySetOf<MediaRouteRuleEntry>()([
	'domain',
	'pathPrefix',
	'fingerprint',
	'route',
	'source',
	'updatedAt',
]);
const DOMAIN_ENTRY_KEYS = /* @__PURE__ */ keySetOf<DomainEntry>()([
	'domain',
	'fingerprint',
	'route',
	'source',
	'updatedAt',
]);
const MEDIA_ROUTE_CHANGED_KEYS = /* @__PURE__ */ keySetOf<MediaRouteChangedEvent>()(['domain', 'mediaRoute']);
const REGISTRY_SNAPSHOT_KEYS = /* @__PURE__ */ keySetOf<RegistrySnapshot>()(['entries']);
const REGISTRY_ADD_RESULT_KEYS = /* @__PURE__ */ keySetOf<RegistryAddResult>()(['entries', 'entry', 'created']);
const REGISTRY_REMOVE_RESULT_KEYS = /* @__PURE__ */ keySetOf<RegistryRemoveResult>()(['entries', 'removed']);
const REGISTRY_QUERY_RESULT_KEYS = /* @__PURE__ */ keySetOf<RegistryQueryResult>()(['entry']);
const REGISTRY_ADD_PAYLOAD_KEYS = /* @__PURE__ */ keySetOf<RegistryAddPayload>()(['domain', 'route', 'force']);
const REGISTRY_REMOVE_PAYLOAD_KEYS = /* @__PURE__ */ keySetOf<RegistryRemovePayload>()(['fingerprint']);
const REGISTRY_QUERY_PAYLOAD_KEYS = /* @__PURE__ */ keySetOf<RegistryQueryPayload>()(['domain', 'fingerprint']);
const REGISTRY_RECORD_PAYLOAD_KEYS = /* @__PURE__ */ keySetOf<RegistryRecordPayload>()([
	'domain',
	'fingerprint',
	'route',
	'force',
]);
const MEDIA_FINGERPRINT_PATTERN = /^media:v1:[a-f0-9]{16}$/;

function normalizePathPrefix(value: string | undefined): string | undefined {
	if (value === undefined || value === '' || value === '/') return undefined;
	if (!value.startsWith('/') || value.length > 2048) return undefined;
	try {
		const pathname = new URL(value, 'https://spectra.invalid').pathname;
		const normalized = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname;
		return normalized === '/' ? undefined : normalized;
	} catch {
		return undefined;
	}
}

export function normalizeMediaRouteScope(
	domain: string,
	pathPrefix?: string,
): MediaRouteScope | null {
	const normalizedDomain = normalizeHostname(domain);
	if (!normalizedDomain) return null;
	const normalizedPath = normalizePathPrefix(pathPrefix);
	if (pathPrefix !== undefined && pathPrefix !== '' && pathPrefix !== '/' && normalizedPath === undefined) {
		return null;
	}
	return normalizedPath
		? { domain: normalizedDomain, pathPrefix: normalizedPath }
		: { domain: normalizedDomain };
}

export function parseMediaRouteScopeInput(value: string): MediaRouteScope | null {
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 2048) return null;
	try {
		const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed);
		const url = new URL(explicitScheme ? trimmed : `https://${trimmed}`);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		if (url.username || url.password || url.port) return null;
		return normalizeMediaRouteScope(url.hostname, url.pathname);
	} catch {
		return null;
	}
}

export function createMediaRouteScopeKey(scope: MediaRouteScope): string | null {
	const normalized = normalizeMediaRouteScope(scope.domain, scope.pathPrefix);
	return normalized ? `${normalized.domain}${normalized.pathPrefix ?? ''}` : null;
}

export function parseMediaRouteScopeKey(value: string): MediaRouteScope | null {
	const slash = value.indexOf('/');
	const domain = slash === -1 ? value : value.slice(0, slash);
	const pathPrefix = slash === -1 ? undefined : value.slice(slash);
	const scope = normalizeMediaRouteScope(domain, pathPrefix);
	return scope && createMediaRouteScopeKey(scope) === value ? scope : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMediaProcessingRoute(value: unknown): value is MediaProcessingRoute {
	return value === 'direct' || value === 'capture';
}

export function createSiteRouteFingerprint(domain: string): string | null {
	const normalized = normalizeHostname(domain);
	return normalized ? `site:${normalized}` : null;
}

export function createMediaRouteRuleFingerprint(scope: MediaRouteScope): string | null {
	const key = createMediaRouteScopeKey(scope);
	return key ? `site:${key}` : null;
}

export function isMediaRouteFingerprint(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	if (MEDIA_FINGERPRINT_PATTERN.test(value)) return true;
	if (!value.startsWith('site:')) return false;
	return parseMediaRouteScopeKey(value.slice('site:'.length)) !== null;
}

export function isMediaRouteEntry(value: unknown): value is MediaRouteEntry {
	if (!isRecord(value)
		|| Object.keys(value).some((key) => !MEDIA_ROUTE_ENTRY_KEYS.has(key as keyof MediaRouteEntry))) return false;
	return isMediaProcessingRoute(value.route)
		&& (value.source === 'user' || value.source === 'auto')
		&& Number.isSafeInteger(value.updatedAt)
		&& Number(value.updatedAt) >= 0;
}

export function isDomainEntry(value: unknown): value is DomainEntry {
	if (!isRecord(value)
		|| Object.keys(value).some((key) => !DOMAIN_ENTRY_KEYS.has(key as keyof DomainEntry))) return false;
	return typeof value.domain === 'string'
		&& normalizeHostname(value.domain) === value.domain
		&& isMediaRouteFingerprint(value.fingerprint)
		&& (!value.fingerprint.startsWith('site:')
			|| value.fingerprint === createSiteRouteFingerprint(value.domain))
		&& isMediaProcessingRoute(value.route)
		&& (value.source === 'user' || value.source === 'auto')
		&& Number.isSafeInteger(value.updatedAt)
		&& Number(value.updatedAt) >= 0;
}

export function isRegistryEntries(value: unknown): value is DomainEntry[] {
	return Array.isArray(value)
		&& value.length <= 10_000
		&& value.every(isDomainEntry)
		&& new Set(value.map((entry) => entry.fingerprint)).size === value.length;
}

export function isRegistrySnapshot(value: unknown): value is RegistrySnapshot {
	return isRecord(value)
		&& Object.keys(value).every((key) => REGISTRY_SNAPSHOT_KEYS.has(key as keyof RegistrySnapshot))
		&& Object.keys(value).length === REGISTRY_SNAPSHOT_KEYS.size
		&& isRegistryEntries(value.entries);
}

export function isRegistryAddResult(value: unknown): value is RegistryAddResult {
	if (!isRecord(value)
		|| !Object.keys(value).every((key) => REGISTRY_ADD_RESULT_KEYS.has(key as keyof RegistryAddResult))
		|| Object.keys(value).length !== REGISTRY_ADD_RESULT_KEYS.size
		|| !isRegistryEntries(value.entries)
		|| !isDomainEntry(value.entry)
		|| typeof value.created !== 'boolean') return false;
	const result = value as unknown as RegistryAddResult;
	return result.entries.some((entry) => entry.fingerprint === result.entry.fingerprint);
}

export function isRegistryRemoveResult(value: unknown): value is RegistryRemoveResult {
	return isRecord(value)
		&& Object.keys(value).every((key) => REGISTRY_REMOVE_RESULT_KEYS.has(key as keyof RegistryRemoveResult))
		&& Object.keys(value).length === REGISTRY_REMOVE_RESULT_KEYS.size
		&& isRegistryEntries(value.entries)
		&& typeof value.removed === 'boolean';
}

export function isRegistryQueryResult(value: unknown): value is RegistryQueryResult {
	return isRecord(value)
		&& Object.keys(value).every((key) => REGISTRY_QUERY_RESULT_KEYS.has(key as keyof RegistryQueryResult))
		&& Object.keys(value).length === REGISTRY_QUERY_RESULT_KEYS.size
		&& (value.entry === null || isDomainEntry(value.entry));
}

function isRegistryDomain(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length > 0
		&& value.length <= 2048
		&& normalizeHostname(value) !== null;
}

export function isRegistryAddPayload(value: unknown): value is RegistryAddPayload {
	return isRecord(value)
		&& Object.keys(value).every((key) => REGISTRY_ADD_PAYLOAD_KEYS.has(key as keyof RegistryAddPayload))
		&& isRegistryDomain(value.domain)
		&& isMediaProcessingRoute(value.route)
		&& (value.force === undefined || typeof value.force === 'boolean');
}

export function isRegistryRemovePayload(value: unknown): value is RegistryRemovePayload {
	return isRecord(value)
		&& Object.keys(value).every((key) => REGISTRY_REMOVE_PAYLOAD_KEYS.has(key as keyof RegistryRemovePayload))
		&& isMediaRouteFingerprint(value.fingerprint);
}

export function isRegistryQueryPayload(value: unknown): value is RegistryQueryPayload {
	return isRecord(value)
		&& Object.keys(value).every((key) => REGISTRY_QUERY_PAYLOAD_KEYS.has(key as keyof RegistryQueryPayload))
		&& isRegistryDomain(value.domain)
		&& isMediaRouteFingerprint(value.fingerprint);
}

export function isRegistryRecordPayload(value: unknown): value is RegistryRecordPayload {
	return isRecord(value)
		&& Object.keys(value).every((key) => REGISTRY_RECORD_PAYLOAD_KEYS.has(key as keyof RegistryRecordPayload))
		&& isRegistryDomain(value.domain)
		&& isMediaRouteFingerprint(value.fingerprint)
		&& isMediaProcessingRoute(value.route)
		&& (value.force === undefined || typeof value.force === 'boolean');
}

export function isMediaRouteSettings(value: unknown, maximumEntries = 10_000): value is MediaRouteSettings {
	if (!isRecord(value) || Object.keys(value).length > maximumEntries) return false;
	return Object.entries(value).every(([domain, entry]) => (
		parseMediaRouteScopeKey(domain) !== null && isMediaRouteEntry(entry)
	));
}

export function isMediaRouteRuleEntry(value: unknown): value is MediaRouteRuleEntry {
	if (!isRecord(value)
		|| Object.keys(value).some((key) => !MEDIA_ROUTE_RULE_ENTRY_KEYS.has(key as keyof MediaRouteRuleEntry))
		|| typeof value.domain !== 'string'
		|| typeof value.fingerprint !== 'string'
		|| value.pathPrefix !== undefined && typeof value.pathPrefix !== 'string'
		|| !isMediaProcessingRoute(value.route)
		|| value.source !== 'user' && value.source !== 'auto'
		|| !Number.isSafeInteger(value.updatedAt)
		|| Number(value.updatedAt) < 0) return false;
	const scope = normalizeMediaRouteScope(
		value.domain,
		typeof value.pathPrefix === 'string' ? value.pathPrefix : undefined,
	);
	return scope !== null
		&& (value.pathPrefix === undefined || scope.pathPrefix === value.pathPrefix)
		&& value.fingerprint === createMediaRouteRuleFingerprint(scope);
}

export function isMediaRouteRulesSnapshot(value: unknown): value is MediaRouteRulesSnapshot {
	return isRecord(value)
		&& Object.keys(value).length === 1
		&& Array.isArray(value.entries)
		&& value.entries.length <= 10_000
		&& value.entries.every(isMediaRouteRuleEntry)
		&& new Set(value.entries.map((entry) => entry.fingerprint)).size === value.entries.length;
}

export function isMediaRouteRuleUpsertPayload(value: unknown): value is MediaRouteRuleUpsertPayload {
	if (!isRecord(value)
		|| Object.keys(value).some((key) => key !== 'domain' && key !== 'pathPrefix' && key !== 'route')
		|| typeof value.domain !== 'string'
		|| !isMediaProcessingRoute(value.route)
		|| value.pathPrefix !== undefined && typeof value.pathPrefix !== 'string') return false;
	const scope = normalizeMediaRouteScope(value.domain, value.pathPrefix as string | undefined);
	return scope !== null && (value.pathPrefix === undefined || scope.pathPrefix === value.pathPrefix);
}

export function isMediaRouteChangedEvent(value: unknown): value is MediaRouteChangedEvent {
	if (!isRecord(value)
		|| Object.keys(value).some((key) => !MEDIA_ROUTE_CHANGED_KEYS.has(key as keyof MediaRouteChangedEvent))) return false;
	return typeof value.domain === 'string'
		&& normalizeHostname(value.domain) === value.domain
		&& (value.mediaRoute === 'auto' || isMediaProcessingRoute(value.mediaRoute));
}

export function isMediaRouteDecision(value: unknown): value is MediaRouteDecision {
	return isRecord(value)
		&& Object.keys(value).length === 2
		&& Object.hasOwn(value, 'mediaRoute')
		&& Object.hasOwn(value, 'source')
		&& (value.mediaRoute === 'auto' || isMediaProcessingRoute(value.mediaRoute))
		&& (value.source === null || value.source === 'user' || value.source === 'auto')
		&& (value.mediaRoute === 'auto' ? value.source === null : value.source !== null);
}

export function isMediaRouteRecordRequest(value: unknown): value is MediaRouteRecordRequest {
	return isRecord(value)
		&& Object.keys(value).every((key) => key === 'route' || key === 'force')
		&& isMediaProcessingRoute(value.route)
		&& (value.force === undefined || typeof value.force === 'boolean');
}

export function selectMediaProcessingRoute(
	hostname: string,
	routes: Readonly<MediaRouteSettings>,
): MediaProcessingRoute | 'auto' {
	const normalized = normalizeHostname(hostname);
	if (!normalized) return 'auto';
	const labels = normalized.split('.');
	for (const source of ['user', 'auto'] as const) {
		for (let index = 0; index < labels.length; index++) {
			const candidate = labels.slice(index).join('.');
			const entry = routes[candidate];
			if (entry?.source === source) return entry.route;
		}
	}
	return 'auto';
}

function pathPrefixMatches(pathname: string, pathPrefix: string | undefined): boolean {
	return pathPrefix === undefined
		|| pathname === pathPrefix
		|| pathname.startsWith(`${pathPrefix}/`);
}

export function selectMediaRouteDecisionForUrl(
	resourceUrl: string,
	routes: Readonly<MediaRouteSettings>,
): MediaRouteDecision {
	let url: URL;
	try {
		url = new URL(resourceUrl);
	} catch {
		return { mediaRoute: 'auto', source: null };
	}
	const domain = normalizeHostname(url.hostname);
	if (!domain || url.protocol !== 'http:' && url.protocol !== 'https:') {
		return { mediaRoute: 'auto', source: null };
	}
	let best: {
		entry: MediaRouteEntry;
		userPriority: number;
		domainLabels: number;
		pathLength: number;
	} | null = null;
	for (const [key, entry] of Object.entries(routes)) {
		const scope = parseMediaRouteScopeKey(key);
		if (!scope
			|| !hostnameMatchesRule(domain, scope.domain)
			|| !pathPrefixMatches(url.pathname, scope.pathPrefix)) continue;
		const candidate = {
			entry,
			userPriority: entry.source === 'user' ? 1 : 0,
			domainLabels: scope.domain.split('.').length,
			pathLength: scope.pathPrefix?.length ?? 0,
		};
		if (!best
			|| candidate.userPriority > best.userPriority
			|| candidate.userPriority === best.userPriority
				&& candidate.domainLabels > best.domainLabels
			|| candidate.userPriority === best.userPriority
				&& candidate.domainLabels === best.domainLabels
				&& candidate.pathLength > best.pathLength) {
			best = candidate;
		}
	}
	return best
		? { mediaRoute: best.entry.route, source: best.entry.source }
		: { mediaRoute: 'auto', source: null };
}
