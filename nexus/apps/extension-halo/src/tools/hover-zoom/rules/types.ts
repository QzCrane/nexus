
// goal: Unified type definitions for Hover Zoom rule system
// eff: Core types + proxy types for backward compatibility

// ==========================================
// Core Rule Types
// ==========================================

export interface ResolveContext {
	url: string;
	element: Element;
	host: string;
	match: RegExpMatchArray | null;
	fetchHtml: (url: string) => Promise<string>;
	fetchJson: <T = unknown>(url: string, headers?: Record<string, string>) => Promise<T>;
	getCookie: (name: string) => string;
	// Target display resolution for adaptive quality selection
	targetWidth?: number;
	targetHeight?: number;
}

export interface RuleMetadata {
	videoCodec?: string;
	audioCodec?: string;
	[key: string]: unknown;
}

export interface RuleResult {
	url: string;
	audioUrl?: string;
	headers?: Record<string, string>;
	fallbackUrl?: string;
	type?: 'image' | 'video' | 'audio';
	caption?: string;
	metadata?: RuleMetadata;
}

export type Resolver = (ctx: ResolveContext) => Promise<string | RuleResult | null>;

export type RuleConfig =
	| Resolver
	| { replace: [RegExp | string, string] }
	| { selector: string; attr?: string }
	| { api: string; type?: 'json' | 'html'; parse?: string | ((data: unknown) => string) };

export interface SiteRule {
	id: string;
	name?: string;
	hosts: string[];
	match?: RegExp | string;
	triggers?: string[];  // Async trigger selectors
	resolve: RuleConfig;
}

// ==========================================
// Proxy Types (Legacy compat)
// ==========================================

export interface ProxyFetchOptions {
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: string;
	responseType?: 'json' | 'text' | 'document';
}

export interface ZoomResult {
	type: 'image' | 'video' | 'gallery';
	sources: string[];
	poster?: string;
	caption?: string;
	headers?: Record<string, string>;
	audioUrl?: string;
}

export interface ProxyAjaxRequest {
	type: 'HALO_HZ_PROXY_AJAX';
	url: string;
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: string;
}

export interface ProxyAjaxResponse {
	success: boolean;
	data?: string;
	error?: string;
}

