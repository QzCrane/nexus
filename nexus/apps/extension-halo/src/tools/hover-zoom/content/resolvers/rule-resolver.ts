// goal: Enhanced resolver integrating site-specific rules
// eff: First tries site rules, falls back to generic image-resolver

import { ruleEngine } from '../../rules/engine';
import { ResolveContext } from '../../rules/core';
import { fetchWithProxy, getCookie } from '../utils/proxy-utils';
import type { ZoomResult } from '../../rules/types';

import { resolveImageSource, ImageSource } from './image-resolver';
// import { applyHdRules } from './hd-rules'; // Removed legacy
import type { HoverZoomSettings } from '../../types';
import type { ResourcePreference } from '../utils/resource-key-helper';

const LOG_TAG = '[HoverZoom:RuleResolver]';

/*
 * Initialize rules for current host (Legacy compat, logic moved to engine)
 */
export async function initRulesForHost(): Promise<void> {
	// No-op: RuleEngine lazy loads/registers rules internally
}

/**
 * Check if keyboard modifiers match trigger settings
 */
export function checkModifiers(e: MouseEvent, settings: HoverZoomSettings): boolean {
	const { triggerKey } = settings;
	if (triggerKey === 'none') return true;
	if (triggerKey === 'shift') return e.shiftKey;
	if (triggerKey === 'ctrl') return e.ctrlKey;
	if (triggerKey === 'alt') return e.altKey;
	return true;
}

/**
 * Check exemptions - elements that should not trigger hover zoom
 */
function checkExemptions(target: HTMLElement, settings: HoverZoomSettings): boolean {
	// Interactive elements
	if (settings.exemptions.smallInteractive) {
		if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) ||
			target.getAttribute('role') === 'button' ||
			target.isContentEditable) {
			return false;
		}
	}

	// Viewport coverage
	const rect = target.getBoundingClientRect();
	const viewportArea = window.innerWidth * window.innerHeight;
	const targetArea = rect.width * rect.height;

	if (targetArea / viewportArea > settings.exemptions.maxViewportCoverage) return false;
	if (rect.width / window.innerWidth > settings.exemptions.maxWidthCoverage) return false;

	return true;
}

/**
 * Enhanced image/video source resolution
 * Priority: Site Rules > Generic Resolver > HD Rules
 * @param target - Target element to resolve
 * @param resourcePref - User's resource preference (image/video/auto)
 */
export async function resolveEnhanced(
	target: HTMLElement,
	resourcePref: ResourcePreference = 'auto'
): Promise<EnhancedResult | null> {
	// First: Try site-specific rules via RuleEngine
	try {
		// Construct URL from common attributes
		const urlToCheck = target.getAttribute('href') || target.getAttribute('src') || target.dataset.targetUrl || '';
		if (urlToCheck) {
			const ctx: ResolveContext = {
				url: urlToCheck,
				element: target,
				host: window.location.hostname,
				match: null,
				fetchHtml: (u) => fetchWithProxy<string>(u, { responseType: 'text' }),
				fetchJson: <T>(u: string, headers?: Record<string, string>) => fetchWithProxy<T>(u, { headers }),
				getCookie
			};

			const result = await ruleEngine.resolve(ctx);

			if (result) {
				const resultObj = typeof result === 'string' ? { url: result, type: 'image' as const } : result;
				const mappedType: 'image' | 'video' | 'svg' =
					resultObj.type === 'audio' ? 'video' : (resultObj.type || 'image');

				console.log(LOG_TAG, `Engine matched rule`, resultObj);

				// Preference check: user wants image but got video -> try thumbnail
				if (resourcePref === 'image' && mappedType === 'video') {
					const thumbImg = target.querySelector('img') || target.closest('a')?.querySelector('img');
					if (thumbImg?.src) {
						return {
							type: 'image',
							url: thumbImg.src,
							caption: '',
							element: target,
							fromRule: 'engine:thumbnail'
						};
					}
				}

				// Return engine result (for auto, video pref with video, image pref with image)
				return {
					type: mappedType,
					url: resultObj.url,
					audioUrl: resultObj.audioUrl,
					headers: resultObj.headers,
					caption: '',
					element: target,
					fromRule: 'engine'
				};
			}
		}
	} catch (e) {
		console.warn(LOG_TAG, 'Engine resolution failed:', e);
	}

	// Fallback: Generic image resolver
	const source = resolveImageSource(target);
	if (!source) return null;

	// NOTE: When user wants video but only image found, we still show the image.
	// This provides better UX than showing nothing.
	// The UI can indicate this is an image fallback if needed.

	const hdUrl = source.url;

	return {
		type: source.type,
		url: hdUrl,
		caption: source.caption,
		element: target,
		originalUrl: source.originalUrl,
		fromRule: null
	};
}

// Patterns that require async API resolution (video links, etc.)
const ASYNC_RESOLVE_PATTERNS = [
	// Bilibili video links
	'a[href*="bilibili.com/video/"]',
	'a[href*="bilibili.com"][href*="/play/ep"]',
	'a[href*="bilibili.tv"][href*="/play/"]',
	'a[href*="bilibili.tv"][href*="/video/"]',
	// Add more patterns as needed for other sites
] as const;

/**
 * Check if element requires async API resolution (e.g., video links)
 * These elements won't have direct image sources, need RuleEngine
 */
export function needsAsyncResolve(target: HTMLElement): boolean {
	for (const pattern of ASYNC_RESOLVE_PATTERNS) {
		if (target.closest(pattern)) return true;
	}
	return false;
}

/**
 * Sync version for quick detection (no API calls)
 * Includes exemption checks
 */
export function detectQuick(target: HTMLElement, settings: HoverZoomSettings): ImageSource | null {
	// Check exemptions first
	if (!checkExemptions(target, settings)) return null;

	// Elements requiring async API resolution should skip direct image resolve
	// RuleEngine will handle these via resolveEnhanced
	if (needsAsyncResolve(target)) {
		return null;
	}

	return resolveImageSource(target);
}

/**
 * Enhanced resolution result
 */
export interface EnhancedResult {
	type: 'image' | 'video' | 'svg';
	url: string;
	audioUrl?: string;
	headers?: Record<string, string>;
	caption?: string;
	element: HTMLElement;
	originalUrl?: string;
	fromRule: string | null;
	fileSize?: number;  // File size in bytes (if available)
}

