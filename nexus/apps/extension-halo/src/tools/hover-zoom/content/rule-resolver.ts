// goal: Enhanced resolver integrating site-specific rules
// eff: First tries site rules, falls back to generic image-resolver

import { getRulesForHost, hasRulesForHost } from '../rules';
import type { ZoomResult } from '../rules/types';
import { createResolveContext } from './proxy-utils';
import { resolveImageSource, ImageSource } from './image-resolver';
import { applyHdRules } from './hd-rules';
import type { HoverZoomSettings } from '../types';

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
 */
export async function resolveEnhanced(
	target: HTMLElement
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
					console.log(LOG_TAG, `Rule "${rule.id}" matched`, result);
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

	// Check if any rule probe matches
	if (cachedRules.length > 0) {
		for (const rule of cachedRules) {
			if (rule.probe && (target.matches(rule.probe) || target.closest(rule.probe))) {
				const link = target.closest('a');
				if (link?.href) {
					return { url: link.href, type: 'video', element: target, caption: '' };
				}
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
}

