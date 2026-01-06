// goal: Resolve high-quality image URL from DOM elements
// eff: Supports img, picture, srcset, background-image, video poster

export interface ImageSource {
	url: string;
	type: 'image' | 'video' | 'svg';
	element: HTMLElement;
	caption?: string;
	originalUrl?: string;
}

const REGEX_URL_CLEAN = /['"']?([^'"]+)['"']?/;
const IMG_EXTENSIONS = /\.(jpeg|jpg|gif|png|webp|bmp|avif)(\?.*)?$/i;

/**
 * Clean and resolve image URL
 * - Handles protocol-relative and relative URLs
 * - Removes Bilibili @xxx.avif/webp size suffixes
 */
function resolveUrl(url: string): string {
	if (!url) return '';
	let resolved = url;

	// Handle protocol-relative and relative URLs
	if (resolved.startsWith('//')) resolved = 'https:' + resolved;
	else if (resolved.startsWith('/')) resolved = window.location.origin + resolved;

	// Bilibili: Remove @size.format suffix (e.g., @320w_200h.webp, @.avif)
	// Pattern: xxx.jpg@anything -> xxx.jpg
	resolved = resolved.replace(/@[^/]*$/, '');

	return resolved;
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

export function resolveImageSource(target: HTMLElement): ImageSource | null {
	if (!target) return null;

	let url = '';
	let type: 'image' | 'video' | 'svg' = 'image';
	const caption = target.getAttribute('alt') || target.getAttribute('title') || '';

	// Priority 1: Data attributes (often contain HD URLs)
	url = getDataHdUrl(target) || '';

	// Priority 2: IMG element
	if (!url && target instanceof HTMLImageElement) {
		// Get src first, then check srcset for larger version
		url = target.currentSrc || target.src;
		const srcsetUrl = getLargestSrcset(target.srcset);
		if (srcsetUrl) url = srcsetUrl;

		// Check parent <picture> for even larger sources
		const picture = target.closest('picture');
		if (picture) {
			for (const src of picture.querySelectorAll('source')) {
				const largest = getLargestSrcset(src.srcset);
				if (largest) { url = largest; break; }
			}
		}
	}
	// Priority 3: SVG - skip
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

	// Priority 6: Link to image
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
