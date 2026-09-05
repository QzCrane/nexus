// goal: own one explicit direct/capture processing route per normalized site

import { normalizeHostname } from './domain.contracts.js';

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

const MEDIA_ROUTE_ENTRY_KEYS = /* @__PURE__ */ new Set<keyof MediaRouteEntry>([
	'route',
	'source',
	'updatedAt',
]);
const DOMAIN_ENTRY_KEYS = /* @__PURE__ */ new Set<keyof DomainEntry>([
	'domain',
	'fingerprint',
	'route',
	'source',
	'updatedAt',
]);
const MEDIA_ROUTE_CHANGED_KEYS = /* @__PURE__ */ new Set<keyof MediaRouteChangedEvent>(['domain', 'mediaRoute']);
const REGISTRY_SNAPSHOT_KEYS = /* @__PURE__ */ new Set<keyof RegistrySnapshot>(['entries']);
const REGISTRY_ADD_RESULT_KEYS = /* @__PURE__ */ new Set<keyof RegistryAddResult>(['entries', 'entry', 'created']);
const REGISTRY_REMOVE_RESULT_KEYS = /* @__PURE__ */ new Set<keyof RegistryRemoveResult>(['entries', 'removed']);
const REGISTRY_QUERY_RESULT_KEYS = /* @__PURE__ */ new Set<keyof RegistryQueryResult>(['entry']);
const REGISTRY_ADD_PAYLOAD_KEYS = /* @__PURE__ */ new Set<keyof RegistryAddPayload>(['domain', 'route', 'force']);
const REGISTRY_REMOVE_PAYLOAD_KEYS = /* @__PURE__ */ new Set<keyof RegistryRemovePayload>(['fingerprint']);
const REGISTRY_QUERY_PAYLOAD_KEYS = /* @__PURE__ */ new Set<keyof RegistryQueryPayload>(['domain', 'fingerprint']);
const REGISTRY_RECORD_PAYLOAD_KEYS = /* @__PURE__ */ new Set<keyof RegistryRecordPayload>([
	'domain',
	'fingerprint',
	'route',
	'force',
]);
const MEDIA_FINGERPRINT_PATTERN = /^media:v1:[a-f0-9]{16}$/;

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

export function isMediaRouteFingerprint(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	if (MEDIA_FINGERPRINT_PATTERN.test(value)) return true;
	if (!value.startsWith('site:')) return false;
	const domain = value.slice('site:'.length);
	return normalizeHostname(domain) === domain;
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
		normalizeHostname(domain) === domain && isMediaRouteEntry(entry)
	));
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
	for (let index = 0; index < labels.length; index++) {
		const candidate = labels.slice(index).join('.');
		const entry = routes[candidate];
		if (entry) return entry.route;
	}
	return 'auto';
}
