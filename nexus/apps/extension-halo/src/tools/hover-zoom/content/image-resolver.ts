// goal: Resolve high-quality image URL from DOM elements
// eff: Supports img, picture, srcset, background-image, video poster

import { applyHdRules } from './hd-rules';

export interface ImageSource {
	url: string;
	type: 'image' | 'video' | 'svg';
	element: HTMLElement;
	caption?: string;
	originalUrl?: string;
}

const REGEX_URL_CLEAN = /['"]?([^'"]+)['"]?/;
const IMG_EXTENSIONS = /\.(jpeg|jpg|gif|png|webp|bmp|avif)(\?.*)?$/i;

function resolveUrl(url: string): string {
	if (!url) return '';
	if (url.startsWith('//')) return 'https:' + url;
	if (url.startsWith('/')) return window.location.origin + url;
	return applyHdRules(url);
}

function getBackgroundImage(el: HTMLElement): string | null {
	const bg = window.getComputedStyle(el).backgroundImage;
	if (bg && bg !== 'none' && bg.startsWith('url(')) {
		const match = bg.match(/url\((.*)\)/);
		if (match?.[1]) {
			const clean = match[1].match(REGEX_URL_CLEAN);
			return clean ? clean[1] : match[1];
		}
	}
	return null;
}

function getLargestSrcset(srcset: string): string | null {
	if (!srcset) return null;
	const sources = srcset.split(',').map(s => {
		const [url, desc] = s.trim().split(/\s+/);
		let w = 0;
		if (desc?.endsWith('w')) w = parseInt(desc);
		else if (desc?.endsWith('x')) w = parseFloat(desc) * 1000;
		return { url, w };
	});
	sources.sort((a, b) => b.w - a.w);
	return sources[0]?.url || null;
}

function getDataHdUrl(el: HTMLElement): string | null {
	for (const attr of ['data-src', 'data-original', 'data-large', 'data-hd', 'data-zoom-src']) {
		const val = el.getAttribute(attr);
		if (val?.startsWith('http')) return val;
	}
	return null;
}

export function resolveImageSource(target: HTMLElement): ImageSource | null {
	if (!target) return null;

	let url = '';
	let type: 'image' | 'video' | 'svg' = 'image';
	const caption = target.getAttribute('alt') || target.getAttribute('title') || '';

	// Data attributes
	url = getDataHdUrl(target) || '';

	// IMG element
	if (!url && target instanceof HTMLImageElement) {
		url = getLargestSrcset(target.srcset) || target.src;
		const picture = target.closest('picture');
		if (picture) {
			for (const src of picture.querySelectorAll('source')) {
				const largest = getLargestSrcset(src.srcset);
				if (largest) { url = largest; break; }
			}
		}
	}
	// SVG - skip
	else if (!url && (target instanceof SVGElement || target.tagName === 'svg')) {
		return null;
	}
	// Video poster
	else if (!url && target instanceof HTMLVideoElement) {
		url = target.poster;
		type = 'video';
	}
	// Background image
	else if (!url) {
		url = getBackgroundImage(target) || '';
	}

	// Link to image
	if (!url) {
		const link = target instanceof HTMLAnchorElement ? target : target.closest('a');
		if (link?.href.match(IMG_EXTENSIONS)) url = link.href;
	}

	// Check child img
	if (!url) {
		const img = target.querySelector('img');
		if (img) return resolveImageSource(img);
	}

	if (!url) return null;
	return { url: resolveUrl(url), type, element: target, caption };
}
