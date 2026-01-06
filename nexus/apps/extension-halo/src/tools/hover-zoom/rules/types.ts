
// goal: Unified type definitions for Hover Zoom site-specific rules
// eff: Preserves legacy types needed for proxy and backward compatibility

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
