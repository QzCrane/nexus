// goal: Resolve high-quality image URL from DOM elements
// eff: Strict matching - only img, video, background-image elements

export interface ImageSource {
	url: string;
	type: 'image' | 'video' | 'svg';
	element: HTMLElement;
	caption?: string;
	originalUrl?: string;
}

const REGEX_URL_CLEAN = /['"]?([^'"]+)['"]?/;
const IMG_EXTENSIONS = /\.(jpeg|jpg|gif|png|webp|bmp|avif|svg)(\?.*)?$/i;

// Minimum size to be considered a valid image trigger
const MIN_SIZE = 20;

/**
 * Clean and resolve image URL
 */
function resolveUrl(url: string): string {
	if (!url) return '';
	let resolved = url;

	if (resolved.startsWith('//')) resolved = 'https:' + resolved;
	else if (resolved.startsWith('/')) resolved = window.location.origin + resolved;

	// Bilibili: Remove @size.format suffix
	resolved = resolved.replace(/@[^/]*$/, '');

	return resolved;
}

function getBackgroundImage(el: HTMLElement): string | null {
	const bg = window.getComputedStyle(el).backgroundImage;
	if (bg && bg !== 'none' && bg.startsWith('url(')) {
		const match = bg.match(/url\((.*)\)/);
		if (match?.[1]) {
			const clean = match[1].match(REGEX_URL_CLEAN);
			const url = clean ? clean[1] : match[1];
			// Filter out gradient/data URLs
			if (url.startsWith('data:') || url.includes('gradient')) return null;
			return url;
		}
	}
	return null;
}

function getLargestSrcset(srcset: string): string | null {
	if (!srcset) return null;
	const sources = srcset.split(',').map(s => {
		const parts = s.trim().split(/\s+/);
		const url = parts[0];
		const desc = parts[1];
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
		if (val?.startsWith('http') || val?.startsWith('//') || val?.startsWith('/')) return val;
	}
	return null;
}

/**
 * Check if element is a valid image/video trigger
 * Excludes text-only elements, buttons, etc.
 */
export function isValidTrigger(target: HTMLElement): boolean {
	if (!target) return false;

	// Must be one of: img, video, canvas, svg, or have background-image
	const isImg = target instanceof HTMLImageElement;
	const isVideo = target instanceof HTMLVideoElement;
	const isCanvas = target instanceof HTMLCanvasElement;
	const isSvg = target instanceof SVGElement || target.tagName === 'svg';

	if (isImg || isVideo || isCanvas || isSvg) {
		// Check minimum size
		const rect = target.getBoundingClientRect();
		return rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
	}

	// Check for background-image
	const bg = window.getComputedStyle(target).backgroundImage;
	if (bg && bg !== 'none' && bg.startsWith('url(') && !bg.includes('gradient')) {
		const rect = target.getBoundingClientRect();
		return rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
	}

	// Check for child img (like link wrapping img)
	const childImg = target.querySelector('img');
	if (childImg) {
		const rect = childImg.getBoundingClientRect();
		return rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
	}

	return false;
}

/**
 * Resolve image source from element
 * Returns null if not a valid image trigger
 */
export function resolveImageSource(target: HTMLElement): ImageSource | null {
	if (!target) return null;

	// Quick check: is this a valid trigger at all?
	if (!isValidTrigger(target)) return null;

	let url = '';
	let type: 'image' | 'video' | 'svg' = 'image';
	const caption = target.getAttribute('alt') || target.getAttribute('title') || '';

	// Priority 1: Data attributes (often contain HD URLs)
	url = getDataHdUrl(target) || '';

	// Priority 2: IMG element
	if (!url && target instanceof HTMLImageElement) {
		url = target.currentSrc || target.src;
		const srcsetUrl = getLargestSrcset(target.srcset);
		if (srcsetUrl) url = srcsetUrl;

		// Check parent <picture>
		const picture = target.closest('picture');
		if (picture) {
			for (const src of picture.querySelectorAll('source')) {
				const largest = getLargestSrcset(src.srcset);
				if (largest) { url = largest; break; }
			}
		}
	}
	// Priority 3: SVG - skip for now
	else if (!url && (target instanceof SVGElement || target.tagName === 'svg')) {
		return null;
	}
	// Priority 4: Video poster
	else if (!url && target instanceof HTMLVideoElement) {
		url = target.poster;
		type = 'video';
	}
	// Priority 5: Background image
	else if (!url) {
		url = getBackgroundImage(target) || '';
	}

	// Priority 6: Link directly to image file
	if (!url) {
		const link = target instanceof HTMLAnchorElement ? target : target.closest('a');
		if (link?.href.match(IMG_EXTENSIONS)) url = link.href;
	}

	// Priority 7: Check child img
	if (!url) {
		const img = target.querySelector('img');
		if (img) return resolveImageSource(img);
	}

	if (!url) return null;

	const resolvedUrl = resolveUrl(url);
	return { url: resolvedUrl, type, element: target, caption, originalUrl: url };
}
