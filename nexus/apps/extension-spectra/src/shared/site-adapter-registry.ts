// goal: state per-site player knowledge as data the allowlisted page-media
// bridge consumes, instead of widening generic heuristics for every player
//
// Why a registry and not a second MAIN script: `04b-source-algorithms.md:75`
// records the page-media bridge as the only allowlisted `document_start` MAIN
// injection. A per-site adapter therefore cannot be its own file without
// breaking SCTRL-004. Expressing the site knowledge as declarative rows keeps
// exactly one MAIN owner and turns "support Douyin" into a data edit plus a
// verification run, not a new injection surface.

import type { SpectraPageMediaField } from './page-media-bridge';

/**
 * `candidate`: derived from static analysis or a probe run that has not yet
 * passed the EPR-028 gate. Usable only while its UI projection resolves at
 * runtime; every use is attributable through `adapterId`.
 *
 * `verified`: the probe runbook has been executed against the live site and its
 * evidence is filed under `docs/research/evidence/`.
 *
 * `disabled`: retained only to kill a bad row without dropping its history.
 */
export type SiteAdapterStatus = 'candidate' | 'verified' | 'disabled';

/** Hard ceilings. A row may widen the generic bounds, never past these. */
export const SITE_ADAPTER_LIMITS = Object.freeze({
	maxAncestorDepth: 24,
	maxAttachedProperties: 512,
	maxPrototypeDepth: 12,
	maxReactFiberDepth: 8,
	maxProjectionAncestors: 24,
	maxProjectionTextNodes: 4096,
	maxProjectionScopes: 6,
});

export interface SiteAdapterDiscovery {
	/**
	 * Setter names tried before the generic list, in order. Order is meaningful:
	 * the first name that resolves to a callable wins, so a site's UI-driving
	 * name must precede its lower-level synonym.
	 */
	readonly setterNames: readonly string[];
	/** Getter names tried before the generic list, in order. */
	readonly getterNames: readonly string[];
	/**
	 * Property names that expose a `get`/`set` accessor pair. A plain data
	 * property never qualifies, so a field merely *named* like the value cannot
	 * be mistaken for a controller.
	 */
	readonly accessorNames: readonly string[];
	/** Extra association keys, tried before the generic list. */
	readonly associationKeys: readonly string[];
	readonly maxAncestorDepth: number;
	readonly maxAttachedProperties: number;
	readonly maxPrototypeDepth: number;
	/** Walk `__reactFiber$*` / `__reactProps$*` mounts for a controller. */
	readonly followReactFiber: boolean;
}

/**
 * The UI projection is the whole point of a declared adapter: it is the only
 * channel that reports what the player *shows*, which is exactly what a
 * `playbackRate` write cannot move.
 *
 * `tolerance` exists because a badge is rounded ("1.0x" for 1.04). A write is
 * only accepted when the projection agrees with the request inside it, so a
 * stale badge fails the write instead of silently diverging.
 */
export interface SiteSpeedProjectionSpec {
	readonly kind: 'text';
	/** Tried in order; the first selector that resolves contributes a scope. */
	readonly scopeSelectors: readonly string[];
	/** Regex sources, each with exactly one capture group holding the number. */
	readonly patterns: readonly string[];
	readonly tolerance: number;
}

export interface SiteAdapterEntry {
	readonly id: string;
	/** Bare registrable domains or exact hostnames; `.` boundaries are enforced. */
	readonly hosts: readonly string[];
	readonly field: SpectraPageMediaField;
	/** Bumped whenever the declared shape changes; surfaces in evidence. */
	readonly revision: number;
	readonly status: SiteAdapterStatus;
	readonly discovery: SiteAdapterDiscovery;
	/**
	 * `null` means the row carries discovery knowledge only. Such a row can
	 * answer a `probe` but is never allowed to author a write, because a write
	 * with no UI witness is precisely the failure this registry exists to end.
	 */
	readonly projection: SiteSpeedProjectionSpec | null;
}

export const DEFAULT_SITE_ADAPTER_DISCOVERY: SiteAdapterDiscovery = Object.freeze({
	setterNames: Object.freeze([]) as readonly string[],
	getterNames: Object.freeze([]) as readonly string[],
	accessorNames: Object.freeze([]) as readonly string[],
	associationKeys: Object.freeze([]) as readonly string[],
	maxAncestorDepth: 12,
	maxAttachedProperties: 96,
	maxPrototypeDepth: 8,
	followReactFiber: false,
});

/**
 * The vocabulary generic discovery already knows.
 *
 * A declared row is an *addition* to this list, never a repetition: a repeated
 * name cannot confer priority, and a row that repeated one would silently lose
 * to a nearer generic controller. Keeping the list here (instead of inside the
 * bridge) is what lets the registry test reject that mistake before it ships.
 */
export const GENERIC_PAGE_MEDIA_VOCABULARY = Object.freeze({
	speedSetterNames: Object.freeze([
		'setPlaybackRate',
		'setPlaybackRateByUser',
		'changePlaybackRate',
	]),
	speedGetterNames: Object.freeze(['getPlaybackRate']),
	speedAccessorNames: Object.freeze(['playbackRate']),
	mediaReferenceKeys: Object.freeze(['video', 'media', 'mediaElement', 'element']),
	rootReferenceKeys: Object.freeze(['root', 'el', 'container']),
});

/**
 * Douyin's player is a React SPA: the speed badge is a render of component
 * state, and the controller reaches its media element through a key the generic
 * whitelist does not carry (`videoEl`-style refs) with a setter name it does not
 * probe (`setSpeed`). `docs/research/2026-11-01-spectra-douyin-speed-sync-root-cause.md`
 * records the evidence for both gaps.
 *
 * `status: 'candidate'` is deliberate. The row ships with runtime verification
 * built in (a write is only accepted when the badge agrees), but the badge
 * selectors have not been confirmed against a live tab, so the row must not
 * claim `verified` before `docs/research/2026-11-01-spectra-douyin-speed-probe-runbook.md`
 * has been executed and filed.
 */
const DOUYIN_SPEED: SiteAdapterEntry = Object.freeze({
	id: 'douyin-speed',
	hosts: Object.freeze(['douyin.com', 'iesdouyin.com']),
	field: 'speed',
	revision: 1,
	status: 'candidate',
	discovery: Object.freeze({
		setterNames: Object.freeze([
			// Only names generic discovery does not probe. `setPlaybackRate` and
			// friends stay in the generic pass; repeating them here would make the
			// decoy controllers on a page look declared as well.
			'setSpeed',
			'updateSpeed',
		]),
		getterNames: Object.freeze(['getSpeed']),
		accessorNames: Object.freeze(['speed']),
		associationKeys: Object.freeze([
			'videoEl',
			'videoElement',
			'mediaEl',
			'player',
			'playerInstance',
			'core',
		]),
		maxAncestorDepth: 18,
		maxAttachedProperties: 288,
		maxPrototypeDepth: 8,
		followReactFiber: true,
	}),
	projection: Object.freeze({
		kind: 'text',
		scopeSelectors: Object.freeze([
			'[data-e2e="speed"]',
			'[data-e2e="player-speed"]',
			'[class*="speed" i]',
		]),
		patterns: Object.freeze([
			'^(\\d+(?:\\.\\d+)?)\\s*[xX×]$',
			'^(\\d+(?:\\.\\d+)?)\\s*倍$',
		]),
		tolerance: 0.06,
	}),
});

export const SITE_ADAPTER_REGISTRY: readonly SiteAdapterEntry[] = Object.freeze([
	DOUYIN_SPEED,
]);

function normalizeHost(host: string): string {
	return host.trim().toLowerCase().replace(/^\.+/, '');
}

/**
 * `.` boundaries are enforced so `evildouyin.com` cannot inherit a row
 * registered for `douyin.com`. A bare entry covers every subdomain, which is
 * what `m.` / `www.` / regional hosts all need.
 */
export function siteAdapterMatchesHost(entry: SiteAdapterEntry, hostname: string): boolean {
	const host = hostname.trim().toLowerCase();
	if (host.length === 0) return false;
	return entry.hosts.some((raw) => {
		const normalized = normalizeHost(raw);
		return normalized.length > 0
			&& (host === normalized || host.endsWith(`.${normalized}`));
	});
}

export function resolveSiteAdapter(
	hostname: string,
	field: SpectraPageMediaField,
): SiteAdapterEntry | null {
	for (const entry of SITE_ADAPTER_REGISTRY) {
		if (entry.field !== field || entry.status === 'disabled') continue;
		if (siteAdapterMatchesHost(entry, hostname)) return entry;
	}
	return null;
}

/** The executor's view: resolved against the document the content script owns. */
export function resolveDeclaredSiteAdapter(
	field: SpectraPageMediaField,
): SiteAdapterEntry | null {
	const hostname = globalThis.location?.hostname;
	return typeof hostname === 'string' && hostname.length > 0
		? resolveSiteAdapter(hostname, field)
		: null;
}

/**
 * A row may only widen a generic bound. Clamping here rather than at each use
 * site keeps the bridge's traversal cost a property of the registry, which is
 * what makes "add a row" reviewable.
 */
export function siteAdapterBounds(discovery: SiteAdapterDiscovery | null): {
	maxAncestorDepth: number;
	maxAttachedProperties: number;
	maxPrototypeDepth: number;
} {
	const source = discovery ?? DEFAULT_SITE_ADAPTER_DISCOVERY;
	const clamp = (value: number, fallback: number, limit: number): number => (
		Number.isFinite(value) && value >= 0 ? Math.min(Math.trunc(value), limit) : fallback
	);
	return {
		maxAncestorDepth: clamp(source.maxAncestorDepth, 12, SITE_ADAPTER_LIMITS.maxAncestorDepth),
		maxAttachedProperties: clamp(source.maxAttachedProperties, 96, SITE_ADAPTER_LIMITS.maxAttachedProperties),
		maxPrototypeDepth: clamp(source.maxPrototypeDepth, 8, SITE_ADAPTER_LIMITS.maxPrototypeDepth),
	};
}

export interface SiteAdapterDiagnostics {
	readonly id: string;
	readonly host: string;
	readonly field: SpectraPageMediaField;
	readonly revision: number;
	readonly status: SiteAdapterStatus;
	readonly hasProjection: boolean;
}

/** Small, serialisable shape for diagnostics without leaking the entry itself. */
export function describeSiteAdapter(
	entry: SiteAdapterEntry,
	hostname: string,
): SiteAdapterDiagnostics {
	return {
		id: entry.id,
		host: hostname,
		field: entry.field,
		revision: entry.revision,
		status: entry.status,
		hasProjection: entry.projection !== null,
	};
}
