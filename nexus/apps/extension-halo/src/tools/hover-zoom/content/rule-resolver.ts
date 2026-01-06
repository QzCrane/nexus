// goal: Enhanced resolver integrating site-specific rules
// eff: First tries site rules, falls back to generic image-resolver

import { getRulesForHost, hasRulesForHost } from '../rules';
import type { ZoomResult } from '../rules/types';
import { createResolveContext } from './proxy-utils';
import { resolveImageSource, ImageSource } from './image-resolver';
import { applyHdRules } from './hd-rules';

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
 * Enhanced image/video source resolution
 * Priority: Site Rules > Generic Resolver > HD Rules
 */
export async function resolveEnhanced(
	target: HTMLElement
): Promise<EnhancedResult | null> {
	// First: Try site-specific rules (async)
	if (cachedRules.length > 0) {
		for (const rule of cachedRules) {
			// Quick probe check
			if (rule.probe && !target.matches(rule.probe) && !target.closest(rule.probe)) {
				continue;
			}

			try {
				const ctx = createResolveContext(target, target.getAttribute('href') || '');
				const result = await rule.resolve(ctx);
				if (result) {
					console.log(LOG_TAG, `Rule "${rule.id}" matched`, result);
					// Map gallery type to video for compatibility
					const mappedType: 'image' | 'video' | 'svg' =
						result.type === 'gallery' ? 'image' : result.type;
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

	// Apply HD URL upgrades
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
 * Used for initial hover detection before async resolution
 */
export function detectQuick(target: HTMLElement): ImageSource | null {
	// Check if any rule probe matches
	if (cachedRules.length > 0) {
		for (const rule of cachedRules) {
			if (rule.probe && (target.matches(rule.probe) || target.closest(rule.probe))) {
				// Return minimal source to indicate potential match
				const link = target.closest('a');
				if (link?.href) {
					return {
						url: link.href,
						type: 'video',
						element: target,
						caption: ''
					};
				}
			}
		}
	}

	// Fallback to standard resolver
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
}
