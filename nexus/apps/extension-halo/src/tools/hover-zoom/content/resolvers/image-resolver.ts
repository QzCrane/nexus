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

// Performance: Cache isValidTrigger results (cleared on scroll/resize)
const validTriggerCache = new WeakMap<HTMLElement, boolean>();
const bgImageCache = new WeakMap<HTMLElement, string | null>();

/**
 * Clean and resolve image URL
 */
function resolveUrl(url: string): string {
	if (!url) return '';
	let resolved = url;

	if (resolved.startsWith('//')) resolved = 'https:' + resolved;
	else if (resolved.startsWith('/')) resolved = window.location.origin + resolved;

	// Bilibili logic moved to RuleEngine
	// resolved = resolved.replace(/@[^/]*$/, '');

	return resolved;
}

function getBackgroundImage(el: HTMLElement): string | null {
	if (bgImageCache.has(el)) return bgImageCache.get(el) ?? null;
	const bg = window.getComputedStyle(el).backgroundImage;
	let result: string | null = null;
	if (bg && bg !== 'none' && bg.startsWith('url(')) {
		const match = bg.match(/url\((.*)\)/);
		if (match?.[1]) {
			const url = match[1].match(REGEX_URL_CLEAN)?.[1] ?? match[1];
			if (!url.startsWith('data:') && !url.includes('gradient')) result = url;
		}
	}
	bgImageCache.set(el, result);
	return result;
}

function getLargestSrcset(srcset: string): string | null {
	if (!srcset) return null;
	const sources = srcset.split(',').map(s => {
		const [url, desc] = s.trim().split(/\s+/);
		const w = desc?.endsWith('w') ? parseInt(desc) : desc?.endsWith('x') ? parseFloat(desc) * 1000 : 0;
		return { url, w };
	}).sort((a, b) => b.w - a.w);
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
 * Checks: img, video, canvas, svg, background-image, or direct parent of these
 */
export function isValidTrigger(target: HTMLElement): boolean {
	if (!target) return false;

	// Check cache first (significant performance boost)
	if (validTriggerCache.has(target)) return validTriggerCache.get(target)!;

	let valid = false;

	// Must be one of: img, video, canvas, svg, or have background-image
	const isImg = target instanceof HTMLImageElement;
	const isVideo = target instanceof HTMLVideoElement;
	const isCanvas = target instanceof HTMLCanvasElement;
	const isSvg = target instanceof SVGElement || target.tagName === 'svg';

	if (isImg || isVideo || isCanvas || isSvg) {
		// Check minimum size
		const rect = target.getBoundingClientRect();
		valid = rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
	} else {
		// Check for background-image (using cached result)
		const bg = getBackgroundImage(target);
		if (bg) {
			const rect = target.getBoundingClientRect();
			valid = rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
		} else {
			// Check for direct child img or video (like <a><img>...</a>)
			const childMedia = target.querySelector(':scope > img, :scope > video, :scope > picture > img');
			if (childMedia) {
				const rect = childMedia.getBoundingClientRect();
				valid = rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
			} else {
				// Check for nested img in anchor (B站等站点的视频卡片结构)
				// Only for anchors with video/play patterns
				if (target instanceof HTMLAnchorElement) {
					const href = target.href || '';
					const isVideoLink = /\/(video|play)\//.test(href);
					if (isVideoLink) {
						const nestedImg = target.querySelector('img');
						if (nestedImg) {
							const rect = nestedImg.getBoundingClientRect();
							valid = rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
						}
					}
				}
			}
		}
	}

	validTriggerCache.set(target, valid);
	return valid;
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
