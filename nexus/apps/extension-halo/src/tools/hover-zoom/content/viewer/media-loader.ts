// goal: Media loading utilities for HoverZoom viewer
// eff: Functions for checking video playability and finding thumbnails

import type { EnhancedResult } from '../resolvers/rule-resolver';

const LOG_TAG = '[HALO:HoverZoom:MediaLoader]';

/**
 * Check if URL is a DASH segment (.m4s) that cannot be played directly.
 */
export function isDashSegment(url: string): boolean {
	return /\.m4s(\?|$)/i.test(url) || /\.m4a(\?|$)/i.test(url);
}

/**
 * Check if URL looks like a playable video format.
 */
export function isPlayableVideoUrl(url: string): boolean {
	// Allow common video formats and blob URLs
	if (url.startsWith('blob:')) return true;
	// Check for common video extensions
	return /\.(mp4|webm|ogg|mov|m3u8)(\?|$)/i.test(url) ||
		// Some CDNs use query params for format
		/format=(mp4|webm)/i.test(url) ||
		// Short video URLs from social platforms often work
		url.includes('/video/') ||
		url.includes('.mp4') ||
		url.includes('.webm');
}

/**
 * Find thumbnail URL from a source element using multiple strategies.
 * Returns null if no thumbnail found.
 * Applies inline HD rule: removes @ suffix for Bilibili URLs.
 */
export function findThumbnailUrl(el: HTMLElement | null): string | null {
	if (!el) return null;

	let thumbUrl: string | null = null;

	// Strategy 1: Direct img child
	const directImg = el.querySelector('img') as HTMLImageElement | null;
	if (directImg?.src) {
		thumbUrl = directImg.src;
		console.log(LOG_TAG, 'Found via Strategy 1 (direct img):', thumbUrl.slice(0, 60));
	}

	// Strategy 2: Parent link's img
	if (!thumbUrl) {
		const parentLink = el.closest('a');
		const linkImg = parentLink?.querySelector('img') as HTMLImageElement | null;
		if (linkImg?.src) {
			thumbUrl = linkImg.src;
			console.log(LOG_TAG, 'Found via Strategy 2 (parent link):', thumbUrl.slice(0, 60));
		}
	}

	// Strategy 3: Bilibili card structure
	if (!thumbUrl) {
		const card = el.closest('.bili-video-card, .video-card, [class*="card"]');
		const cardImg = card?.querySelector('img') as HTMLImageElement | null;
		if (cardImg?.src) {
			thumbUrl = cardImg.src;
			console.log(LOG_TAG, 'Found via Strategy 3 (card structure):', thumbUrl.slice(0, 60));
		}
	}

	// Strategy 4: Background image
	if (!thumbUrl) {
		const bgEl = el.querySelector('[style*="background"]') || el;
		const style = getComputedStyle(bgEl);
		const bgMatch = style.backgroundImage?.match(/url\(["']?([^"')]+)["']?\)/);
		if (bgMatch?.[1]) {
			thumbUrl = bgMatch[1];
			console.log(LOG_TAG, 'Found via Strategy 4 (background image):', thumbUrl.slice(0, 60));
		}
	}

	if (!thumbUrl) return null;

	// Inline HD: Remove @ suffix for Bilibili images (hdslb.com, bstarstatic.com, etc.)
	if (/@/.test(thumbUrl) && /hdslb\.com|bstarstatic\.com|biliimg\.com/.test(thumbUrl)) {
		const atIndex = thumbUrl.indexOf('@');
		if (atIndex !== -1) {
			const hdUrl = thumbUrl.substring(0, atIndex);
			console.log(LOG_TAG, 'HD applied:', thumbUrl.slice(-40), '→', hdUrl.slice(-40));
			return hdUrl;
		}
	}

	return thumbUrl;
}

/**
 * Result of thumbnail search with metadata
 */
export interface ThumbnailResult {
	url: string;
	source: EnhancedResult;
}

/**
 * Create a modified EnhancedResult with thumbnail URL
 */
export function createThumbnailResult(source: EnhancedResult, thumbUrl: string): EnhancedResult {
	return { ...source, type: 'image', url: thumbUrl };
}
