// goal: Unified type definitions for Hover Zoom site-specific rules
// eff: Adapted from HoverZoom+ plugin format, modernized without jQuery

/**
 * Context passed to rule resolver
 * Provides necessary info and utilities for URL resolution
 */
export interface ResolveContext {
	/** URL of the hovered element (href, src, or computed) */
	url: string;
	/** The DOM element being hovered */
	element: Element;
	/** Current page URL */
	pageUrl: string;
	/** Fetch with CORS bypass via background proxy */
	fetchWithProxy: <T = unknown>(url: string, opts?: ProxyFetchOptions) => Promise<T>;
	/** Get cookie value by name */
	getCookie: (name: string) => string;
}

/**
 * Options for proxy fetch requests
 */
export interface ProxyFetchOptions {
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: string;
	/** Response type hint */
	responseType?: 'json' | 'text' | 'document';
}

/**
 * Result returned by rule resolver
 */
export interface ZoomResult {
	/** Content type */
	type: 'image' | 'video' | 'gallery';
	/** Media URLs in priority order (first = best quality) */
	sources: string[];
	/** Poster image for video */
	poster?: string;
	/** Caption or title */
	caption?: string;
	/** Optional headers required for fetching media (anti-hotlink) */
	headers?: Record<string, string>;
	/** For DASH: separate audio track URL */
	audioUrl?: string;
}

/**
 * Site-specific rule definition
 * Each rule handles a specific website's image/video resolution logic
 */
export interface SiteRule {
	/** Unique rule identifier */
	id: string;
	/** Human-readable name */
	name: string;
	/** Version string (semver) */
	version: string;
	/**
	 * Check if this rule applies to the current host
	 * @param host - Current page hostname (e.g., "www.bilibili.com")
	 */
	matches: (host: string) => boolean;
	/**
	 * CSS selector to pre-filter elements (performance optimization)
	 * Only process elements matching this selector
	 */
	probe?: string;
	/**
	 * Resolve high-quality media URL from element
	 * @returns ZoomResult or null if no media found
	 */
	resolve: (ctx: ResolveContext) => Promise<ZoomResult | null>;
	/** Priority for rule ordering (higher = first). Default: 0 */
	priority?: number;
}

// ============ Background Message Types ============

/** Message type for AJAX proxy request */
export interface ProxyAjaxRequest {
	type: 'HALO_HZ_PROXY_AJAX';
	url: string;
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: string;
}

/** Message type for AJAX proxy response */
export interface ProxyAjaxResponse {
	success: boolean;
	data?: string;
	error?: string;
}

// ============ Rule Registry Types ============

/**
 * Rule loader function - lazy load rules on demand
 */
export type RuleLoader = () => Promise<SiteRule>;

/**
 * Rule registry entry
 */
export interface RuleRegistryEntry {
	id: string;
	/** Host patterns this rule handles (for quick lookup) */
	hostPatterns: string[];
	/** Lazy loader */
	loader: RuleLoader;
	/** Cached rule instance */
	rule?: SiteRule;
}
