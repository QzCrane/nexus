
// goal: Identify valid trigger elements for Hover Zoom
// eff: Caching, background image detection, strict validation

const REGEX_URL_CLEAN = /['"]?([^'"]+)['"]?/;

// Minimum size to be considered a valid image trigger
const MIN_SIZE = 20;

// Performance: Cache isValidTrigger results (cleared on scroll/resize)
const validTriggerCache = new WeakMap<HTMLElement, boolean>();
const bgImageCache = new WeakMap<HTMLElement, string | null>();

/**
 * Extract URL from background-image style
 */
export function getBackgroundImage(el: HTMLElement): string | null {
	if (bgImageCache.has(el)) return bgImageCache.get(el) ?? null;
	const bg = window.getComputedStyle(el).backgroundImage;
	let result: string | null = null;
	if (bg && bg !== 'none' && bg.startsWith('url(')) {
		const match = bg.match(/url\((.*)\)/);
		if (match?.[1]) {
			const url = match[1].match(REGEX_URL_CLEAN)?.[1] ?? match[1];
			// Improved check: exclude gradients and data URIs
			if (!url.startsWith('data:') && !url.includes('gradient')) result = url;
		}
	}
	bgImageCache.set(el, result);
	return result;
}

/**
 * Check if element is a valid image/video trigger
 * Checks: img, video, canvas, svg, background-image, or direct parent of these
 */
export function isValidTrigger(target: HTMLElement): boolean {
	if (!target) return false;

	// Check cache first (significant performance boost)
	const cached = validTriggerCache.get(target);
	if (cached !== undefined) return cached;

	let valid = false;

	// Must be one of: img, video, canvas, svg, or have background-image
	const isImg = target instanceof HTMLImageElement;
	const isVideo = target instanceof HTMLVideoElement;
	const isCanvas = target instanceof HTMLCanvasElement;
	const isSvg = target instanceof SVGElement || target.tagName === 'svg';

	if (isImg || isVideo || isCanvas || isSvg) {
		// Skip videos that are playing or in preview animation (like Bilibili hover previews)
		// This prevents HoverZoom from interfering with native video preview behavior
		if (isVideo) {
			const video = target as HTMLVideoElement;
			// Skip if: playing (!paused), has no controls (inline preview), or is a blob (stream)
			if (!video.paused || video.src?.startsWith('blob:')) {
				validTriggerCache.set(target, false);
				return false;
			}
		}

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
