// goal: Enhanced resolver integrating site-specific rules
// eff: First tries site rules, falls back to generic image-resolver

import { getRulesForHost, hasRulesForHost } from '../rules';
import type { ZoomResult } from '../rules/types';
import { createResolveContext } from './proxy-utils';
import { resolveImageSource, ImageSource } from './image-resolver';
import { applyHdRules } from './hd-rules';
import type { HoverZoomSettings } from '../types';
import type { ResourcePreference } from './resource-key-helper';

const LOG_TAG = '[HoverZoom:RuleResolver]';

// Cache loaded rules for current host
let cachedHost: string | null = null;
let cachedRules: Awaited<ReturnType<typeof getRulesForHost>> = [];

/**
 * Initialize rules for current host (call once on page load)
 */
export async function initRulesForHost(): Promise<void> {
	const host = window.location.hostname;
	if (cachedHost === host) return;

	if (hasRulesForHost(host)) {
		cachedRules = await getRulesForHost(host);
		console.log(LOG_TAG, `Loaded ${cachedRules.length} rules for ${host}`);
	} else {
		cachedRules = [];
	}
	cachedHost = host;
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
	// First: Try site-specific rules (async)
	if (cachedRules.length > 0) {
		for (const rule of cachedRules) {
			if (rule.probe && !target.matches(rule.probe) && !target.closest(rule.probe)) {
				continue;
			}

			try {
				const ctx = createResolveContext(target, target.getAttribute('href') || '');
				const result = await rule.resolve(ctx);
				if (result) {
					const mappedType: 'image' | 'video' | 'svg' =
						result.type === 'gallery' ? 'image' : result.type;

					// Check resource preference
					// If user wants image but rule returns video, try to get thumbnail instead
					if (resourcePref === 'image' && mappedType === 'video') {
						// Try to find thumbnail image
						const thumbImg = target.querySelector('img') || target.closest('a')?.querySelector('img');
						if (thumbImg?.src) {
							console.log(LOG_TAG, `User prefers image, using thumbnail instead of video`);
							return {
								type: 'image',
								url: applyHdRules(thumbImg.src),
								caption: '',
								element: target,
								fromRule: rule.id + ':thumbnail'
							};
						}
					}

					// If user wants video but rule returns image, skip this rule
					if (resourcePref === 'video' && mappedType === 'image') {
						console.log(LOG_TAG, `User prefers video, skipping image result from rule "${rule.id}"`);
						continue;
					}

					console.log(LOG_TAG, `Rule "${rule.id}" matched`, result);
					return {
						type: mappedType,
						url: result.sources[0],
						audioUrl: result.audioUrl,
						headers: result.headers,
						caption: result.caption,
						element: target,
						fromRule: rule.id
					};
				}
			} catch (e) {
				console.warn(LOG_TAG, `Rule "${rule.id}" failed:`, e);
			}
		}
	}

	// Fallback: Generic image resolver
	const source = resolveImageSource(target);
	if (!source) return null;

	// If user wants video but we only found image, return null
	if (resourcePref === 'video' && source.type === 'image') {
		console.log(LOG_TAG, `User prefers video, but only image found`);
		return null;
	}

	const hdUrl = applyHdRules(source.url);

	return {
		type: source.type,
		url: hdUrl,
		caption: source.caption,
		element: target,
		originalUrl: source.originalUrl,
		fromRule: null
	};
}

/**
 * Sync version for quick detection (no API calls)
 * Includes exemption checks
 */
export function detectQuick(target: HTMLElement, settings: HoverZoomSettings): ImageSource | null {
	// Check exemptions first
	if (!checkExemptions(target, settings)) return null;

	// Check if any rule probe matches - but DON'T return page URLs!
	// B站视频链接需要 API 解析，不能直接返回页面 URL
	if (cachedRules.length > 0) {
		for (const rule of cachedRules) {
			if (rule.probe && (target.matches(rule.probe) || target.closest(rule.probe))) {
				// Found a rule match - let resolveEnhanced handle it via API
				// For now, try to get thumbnail from nearby img element
				const nearbyImg = target.querySelector('img') || target.closest('a')?.querySelector('img');
				if (nearbyImg?.src && nearbyImg.src.includes('hdslb.com')) {
					return { url: nearbyImg.src, type: 'image', element: target, caption: '' };
				}
				// Don't return page URL - return null and let resolveEnhanced handle it
				return null;
			}
		}
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

