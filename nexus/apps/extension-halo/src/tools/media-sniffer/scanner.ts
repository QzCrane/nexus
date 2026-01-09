// goal: DOM scanner for extracting media elements - injected via content script

import type { MediaItem } from './types';
import { createMediaItem } from './core';

/** Scan document for all media elements */
export function scanPageMedia(): MediaItem[] {
	const items: MediaItem[] = [];

	// 1. Video elements
	document.querySelectorAll('video').forEach((video) => {
		if (video.src) {
			const item = createMediaItem(video.src, 'video', {
				width: video.videoWidth,
				height: video.videoHeight,
				duration: video.duration,
			});
			if (item) items.push(item);
		}
	});

	// 2. Audio elements
	document.querySelectorAll('audio').forEach((audio) => {
		if (audio.src) {
			const item = createMediaItem(audio.src, 'audio', { duration: audio.duration });
			if (item) items.push(item);
		}
	});

	// 3. Source elements (inside video/audio)
	document.querySelectorAll('source').forEach((source) => {
		if (source.src) {
			const item = createMediaItem(source.src, 'source');
			if (item) items.push(item);
		}
	});

	// 4. Image elements
	document.querySelectorAll('img').forEach((img) => {
		// Use currentSrc (respects srcset) or src
		const url = img.currentSrc || img.src;
		if (url && !url.startsWith('data:')) {
			const item = createMediaItem(url, 'img', {
				width: img.naturalWidth,
				height: img.naturalHeight,
			});
			if (item) items.push(item);
		}
	});

	// 5. Picture sources
	document.querySelectorAll('picture source').forEach((source) => {
		const srcset = source.getAttribute('srcset');
		if (srcset) {
			// Parse srcset (take first URL)
			const firstUrl = srcset.split(',')[0]!.trim().split(' ')[0]!;
			if (firstUrl) {
				const item = createMediaItem(firstUrl, 'picture');
				if (item) items.push(item);
			}
		}
	});

	// 6. Background images via CSS
	scanBackgroundImages(items);

	return items;
}

/** Scan computed styles for background images */
function scanBackgroundImages(items: MediaItem[]): void {
	const elements = document.querySelectorAll('*');
	elements.forEach((el) => {
		try {
			const style = getComputedStyle(el);
			const bg = style.backgroundImage;
			if (bg && bg !== 'none') {
				// Extract URL from url("...")
				const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
				if (match && match[1] && !match[1].startsWith('data:')) {
					const item = createMediaItem(match[1], 'background');
					if (item) items.push(item);
				}
			}
		} catch {
			// Skip elements with access errors
		}
	});
}

/** Get serializable scan result for RPC */
export function getScanResultJson(): string {
	const items = scanPageMedia();
	return JSON.stringify({
		items,
		timestamp: Date.now(),
		url: location.href,
	});
}
