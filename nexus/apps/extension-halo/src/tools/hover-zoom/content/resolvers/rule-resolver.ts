// goal: Enhanced resolver integrating site-specific rules
// eff: First tries site rules, falls back to generic image-resolver

import { ruleEngine } from '../../rules/engine';
import { resolveImageSource, type ImageSource } from './image-resolver';
import { buildContext } from './context-builder';
import type { HoverZoomSettings } from '../../types';
import type { ResourcePreference } from '../utils/resource-key-helper';
import type { EnhancedResult } from './enhanced-result';

export type { EnhancedResult } from './enhanced-result';

const LOG_TAG = '[HoverZoom:RuleResolver]';

/** Initialize rules for current host (Legacy compat) */
export async function initRulesForHost(): Promise<void> {
	// No-op: RuleEngine lazy loads/registers rules internally
}

/** Check if keyboard modifiers match trigger settings */
export function checkModifiers(e: MouseEvent, settings: HoverZoomSettings): boolean {
	const { triggerKey } = settings;
	if (triggerKey === 'none') return true;
	if (triggerKey === 'shift') return e.shiftKey;
	if (triggerKey === 'ctrl') return e.ctrlKey;
	if (triggerKey === 'alt') return e.altKey;
	return true;
}

/** Check exemptions - elements that should not trigger hover zoom */
function checkExemptions(target: HTMLElement, settings: HoverZoomSettings): boolean {
	if (settings.exemptions.smallInteractive) {
		if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) ||
			target.getAttribute('role') === 'button' ||
			target.isContentEditable) {
			return false;
		}
	}

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
	target: HTMLElement,
	resourcePref: ResourcePreference = 'auto'
): Promise<EnhancedResult | null> {
	// First: Try site-specific rules via RuleEngine
	try {
		// Priority: parent link href > target href > src > data-target-url
		// This ensures video card cover images resolve to video URL, not image URL
		const parentLink = target.closest('a[href]') as HTMLAnchorElement | null;
		const urlToCheck = parentLink?.href || target.getAttribute('href') || target.getAttribute('src') || target.dataset.targetUrl || '';
		if (urlToCheck) {
			// Calculate target display size for adaptive quality
			// Use 90% of viewport as max display area
			const targetHeight = Math.round(window.innerHeight * 0.9);
			const targetWidth = Math.round(window.innerWidth * 0.9);

			const ctx = buildContext(urlToCheck, target, undefined, targetWidth, targetHeight);
			const result = await ruleEngine.resolve(ctx);

			if (result) {
				const resultObj = typeof result === 'string' ? { url: result, type: 'image' as const } : result;
				const mappedType: 'image' | 'video' | 'svg' =
					resultObj.type === 'audio' ? 'video' : (resultObj.type || 'image');

				console.log(LOG_TAG, `Engine matched rule`, resultObj);

				// Preference check: user wants image but got video -> try thumbnail with HD
				if (resourcePref === 'image' && mappedType === 'video') {
					const thumbImg = target.querySelector('img') || target.closest('a')?.querySelector('img');
					if (thumbImg?.src) {
						// Apply HD rules to thumbnail
						const thumbCtx = buildContext(thumbImg.src, target);
						const hdResult = await ruleEngine.resolve(thumbCtx);
						const hdUrl = hdResult ? (typeof hdResult === 'string' ? hdResult : hdResult.url) : thumbImg.src;
						return { type: 'image', url: hdUrl, caption: '', element: target, fromRule: 'engine:thumbnail' };
					}
				}

				return {
					type: mappedType, url: resultObj.url, audioUrl: resultObj.audioUrl,
					headers: resultObj.headers, caption: '', element: target, fromRule: 'engine', metadata: resultObj.metadata,
					proxyCapability: resultObj.proxyCapability,
				};
			}
		}
	} catch (e) {
		console.warn(LOG_TAG, 'Engine resolution failed:', e);
	}

	// Fallback: Generic image resolver
	const source = resolveImageSource(target);
	if (!source) return null;

	// Apply HD transformation rules
	let hdUrl = source.url;
	try {
		const ctx = buildContext(source.url, target);
		console.log(LOG_TAG, 'Fallback HD transform:', { host: ctx.host, url: source.url.slice(0, 80) });

		const ruleResult = await ruleEngine.resolve(ctx);
		if (ruleResult) {
			hdUrl = typeof ruleResult === 'string' ? ruleResult : ruleResult.url;
			console.log(LOG_TAG, '✅ HD rule applied:', source.url.slice(-60), '->', hdUrl.slice(-60));
		}
	} catch (e) {
		console.warn(LOG_TAG, 'HD rule application failed:', e);
	}

	return {
		type: source.type, url: hdUrl, caption: source.caption, element: target,
		originalUrl: source.originalUrl, fromRule: hdUrl !== source.url ? 'engine:fallback' : null
	};
}

/** Check if element requires async API resolution */
export function needsAsyncResolve(target: HTMLElement): boolean {
	const triggers = ruleEngine.getAllTriggers();
	for (const pattern of triggers) {
		if (target.closest(pattern)) return true;
	}
	return false;
}

/** Sync version for quick detection (no API calls) */
export function detectQuick(target: HTMLElement, settings: HoverZoomSettings): ImageSource | null {
	if (!checkExemptions(target, settings)) return null;
	if (needsAsyncResolve(target)) return null;
	return resolveImageSource(target);
}
