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
	 * Dot path to the numeric field the site's own UI renders from, read off the
	 * controller. A player that keeps no separate state (`player.playbackRate`
	 * proxies the media element) has a truthful projection source and a lying
	 * one; this is how a row names the former. `null` means "use the same value
	 * the write moved".
	 */
	readonly readPath: string | null;
	/**
	 * Property names that expose a `get`/`set` accessor pair. A plain data
	 * property never qualifies, so a field merely *named* like the value cannot
	 * be mistaken for a controller.
	 */
	readonly accessorNames: readonly string[];
	/**
	 * Extra association keys, tried before the generic list. Entries may be dot
	 * paths (`player.video`), which is what lets a controller that owns its
	 * media element through another object still prove ownership.
	 */
	readonly associationKeys: readonly string[];
	/**
	 * Dot paths resolved from `globalThis` (the MAIN world's `window`) for
	 * controllers that are not reachable from the media element at all. A
	 * controller found this way counts as declared knowledge, because the row —
	 * not a heuristic — named where to look.
	 */
	readonly globalPaths: readonly string[];
	readonly maxAncestorDepth: number;
	readonly maxAttachedProperties: number;
	readonly maxPrototypeDepth: number;
	/** Walk `__reactFiber$*` / `__reactProps$*` mounts for a controller. */
	readonly followReactFiber: boolean;
	/**
	 * When every exact `globalPaths` entry resolves to nothing, how to locate the
	 * controller. `'scan-player-plugins'`: walk `player.plugins` (the object
	 * `window.player` resolves to, then `player` itself) and accept the first
	 * member that exposes a rate-like config field or a rate-setter method.
	 *
	 * Douyin renames the playback-plugin key between revisions
	 * (`playbacksettingplugin` → `playbackSettingPlugin` → …); matching by
	 * structural role survives a key rename that would otherwise zero out
	 * discovery and silently degrade the write to the rate-correct-but-UI-blind
	 * proxy accessor.
	 */
	readonly globalPathFallback?: 'scan-player-plugins';
	/**
	 * Extra dot paths tried (in order) when `readPath` yields a non-numeric or
	 * out-of-range value. Lets a row survive a UI-state field rename
	 * (`playBackRatio` → `playbackRatio`) without dropping back to the proxy
	 * read, which is rate-correct but blind to the UI the projection witnesses.
	 */
	readonly readPathFallbacks?: readonly string[];
	/**
	 * When `setterNames` find no callable, scan the controller for a method whose
	 * name matches this case-insensitive pattern and is a function. Survives a
	 * setter rename (`onPlayRatioChange` → `onSpeedChange`) without enumerating
	 * every candidate name in the row.
	 */
	readonly setterNamePattern?: string;
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
	/**
	 * The player container the badge belongs to, as a selector resolved from the
	 * media element upward. A page with preloaded players has several badges in
	 * the document, and the first one in document order is not necessarily the
	 * one that owns this video.
	 */
	readonly rootSelector?: string;
	/** Tried in order; the first selector that resolves contributes a scope. */
	readonly scopeSelectors: readonly string[];
	/**
	 * When set, only text inside elements matching it is considered. This is how
	 * a row distinguishes "the badge" from "the list of every rate the badge
	 * could show": the panel prints `0.75x … 3.0x`, and only one of them carries
	 * the selected marker.
	 */
	readonly selectedSelector?: string;
	/** Regex sources, each with exactly one capture group holding the number. */
	readonly patterns: readonly string[];
	/**
	 * Text the site renders for the *normal* (1x) rate **instead of** a number —
	 * e.g. Douyin labels its 1x option "倍速". A marked item showing this text
	 * means the current rate is 1, so the projection stays readable at the
	 * default rate. Without it the numeric patterns miss, the projection reports
	 * "unreadable", and the UI can no longer be synced from the default rate.
	 */
	readonly defaultLabels?: readonly string[];
	/**
	 * Tried (in order) only when `scopeSelectors` locate nothing. Each value is
	 * matched against the document via `[class*='<value>']` substring matching, so
	 * a class rename (`xgplayer-playratio-item` → `xg-player-speed-item`) still
	 * surfaces the panel instead of leaving the scope empty.
	 */
	readonly scopeSelectorFallbacks?: readonly string[];
	/**
	 * When `selectedSelector` locates no element, scan the resolved scope for
	 * items whose text matches `patterns`, and treat the one carrying a
	 * selected/active/current/checked marker as the current value. Douyin renames
	 * the selected class periodically (`select` → `active`); matching by marker
	 * keeps the projection alive instead of returning an unreadable `null`.
	 */
	readonly selectedFallback?: boolean;
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
	readPath: null,
	accessorNames: Object.freeze([]) as readonly string[],
	associationKeys: Object.freeze([]) as readonly string[],
	globalPaths: Object.freeze([]) as readonly string[],
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
 * Douyin's player is xgplayer inside a React SPA, and the shape measured on a
 * live tab (`docs/research/2026-11-01-spectra-douyin-speed-sync-root-cause.md`,
 * evidence in `docs/research/evidence/2026-11-01-douyin-speed-probe.json`)
 * contradicts what every heuristic would guess:
 *
 * - Nothing is reachable from the media element. The `<video>`'s parent is a
 *   bare `<xg-video-container>`; the xgplayer instance lives on `window.player`,
 *   so an ancestor walk yields zero candidates.
 * - `player.playbackRate` is an accessor over `video.playbackRate`, not state.
 *   Writing it moves the rate and reads back correctly, which is exactly why a
 *   rate-only check can never see this bug.
 * - The badge is `plugin.config.playBackRatio`, updated only by the plugin's
 *   own `onPlayRatioChange`. A live A/B run confirmed: after
 *   `video.playbackRate = 1.5` the panel still marks `1.0x`; after
 *   `plugin.onPlayRatioChange(1.5)` it marks `1.5x`.
 *
 * So the declared write is the plugin method, the declared read is the field
 * the panel renders from, and the projection is the selected list item — never
 * the icon, which says just "倍速" until the site itself has changed the rate.
 *
 * Speed is also gated behind login on the live site: an anonymous tab renders
 * `登录后即可切换倍速` in place of the list. That makes the projection
 * unreadable, which the ledger records as unconfirmed, never as agreement.
 */
const DOUYIN_SPEED: SiteAdapterEntry = Object.freeze({
	id: 'douyin-speed',
	hosts: Object.freeze(['douyin.com', 'iesdouyin.com']),
	field: 'speed',
	revision: 2,
	status: 'verified',
	discovery: Object.freeze({
		setterNames: Object.freeze([
			// The plugin method the site's own click handler calls. Numeric argument,
			// and it is the only path that also re-renders the panel.
			'onPlayRatioChange',
		]),
		getterNames: Object.freeze([]),
		readPath: 'config.playBackRatio',
		// Douyin renames the UI-state field across revisions; the one that survived
		// verification was `config.playBackRatio`. If that is gone, try the
		// camelCase sibling and the other rate-ish keys before giving up and
		// falling back to the rate-correct-but-UI-blind proxy read.
		readPathFallbacks: Object.freeze([
			'config.playbackRatio',
			'config.playBackRatio',
			'config.rate',
			'config.speed',
			'config.ratio',
		]),
		// If `setterNames` finds nothing (renamed setter), accept a method whose
		// name looks like a rate/ratio changer. Case-insensitive.
		setterNamePattern: '^(on|set|change|update|apply)?(play)?(ratio|speed|rate)',
		accessorNames: Object.freeze([]),
		associationKeys: Object.freeze([
			// The plugin owns the media element through the player it was created on.
			'player.video',
		]),
		globalPaths: Object.freeze([
			'player.plugins.playbacksettingplugin',
			// Fallback: the player itself. Its write moves the rate without moving the
			// panel, so the projection audit rejects it and the write rolls back —
			// better a refused write than a silent divergence.
			'player',
		]),
		// The playback plugin key is renamed between Douyin revisions; if the exact
		// global path is missing, walk `player.plugins` for the member that carries
		// a rate-like config field or a rate-setter method.
		globalPathFallback: 'scan-player-plugins',
		maxAncestorDepth: 18,
		maxAttachedProperties: 288,
		maxPrototypeDepth: 8,
		followReactFiber: false,
	}),
	projection: Object.freeze({
		kind: 'text',
		rootSelector: '.xgplayer',
		scopeSelectors: Object.freeze(['.xgplayer-playback-setting']),
		// Class renames leave the panel unlocatable by the exact selector. Fall back
		// to substring class matching so the panel still surfaces.
		scopeSelectorFallbacks: Object.freeze([
			'[class*="playback-setting"]',
			'[class*="playratio"]',
			'[class*="playback-rate"]',
			'[class*="speed"]',
		]),
		selectedSelector: '.xgplayer-playratio-item.select',
		// The selected item's class is renamed periodically (`select` → `active`).
		// When the exact selected selector finds nothing, fall back to scanning the
		// scope for a rate-label item carrying a selected/active/current marker.
		selectedFallback: true,
		patterns: Object.freeze(['^(\\d+(?:\\.\\d+)?)\\s*x$']),
		// The 1x option is rendered as the word "倍速", not as "1.0x". That word
		// *is* 1x — the default, not an unreadable panel. Reading it keeps the
		// projection (and therefore UI sync) alive at the default rate.
		defaultLabels: Object.freeze(['倍速']),
		tolerance: 0.01,
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
