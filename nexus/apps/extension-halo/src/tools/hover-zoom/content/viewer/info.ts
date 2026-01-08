// goal: Info bar updater for HoverZoom viewer
// eff: Display media type, dimensions, format, size, rule source, and caption

import type { ViewerDOM } from '../viewer-dom';
import type { EnhancedResult } from '../resolvers/rule-resolver';
import type { HoverZoomSettings } from '../../types';

/**
 * Format file size to human readable string
 */
function formatFileSize(bytes: number): string {
	if (bytes <= 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Extract format from URL or content type
 */
function getFormat(url: string, mediaType: 'image' | 'video'): string {
	const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
	if (match?.[1]) {
		const ext = match[1].toUpperCase();
		if (['JPG', 'JPEG', 'PNG', 'GIF', 'WEBP', 'AVIF', 'SVG', 'BMP', 'ICO'].includes(ext)) return ext;
		if (['MP4', 'WEBM', 'OGG', 'MOV', 'AVI', 'M4V'].includes(ext)) return ext;
	}
	// Try to infer from URL patterns
	if (url.includes('format=webp') || url.includes('fm=webp')) return 'WEBP';
	if (url.includes('format=jpg') || url.includes('fm=jpg')) return 'JPG';
	if (url.includes('format=png') || url.includes('fm=png')) return 'PNG';
	return mediaType === 'video' ? 'VIDEO' : 'IMG';
}

/**
 * Update the info bar with current media information.
 *
 * @param dom - Viewer DOM elements
 * @param settings - Current HoverZoom settings
 * @param source - Enhanced result with media info
 * @param mediaType - Current media type ('image' or 'video')
 * @param mediaElement - The loaded media element (img or video)
 * @param originalW - Original/natural width of the media
 * @param originalH - Original/natural height of the media
 */
export function updateInfoBar(
	dom: ViewerDOM,
	settings: HoverZoomSettings,
	source: EnhancedResult,
	mediaType: 'image' | 'video',
	mediaElement?: HTMLImageElement | HTMLVideoElement,
	originalW?: number,
	originalH?: number
): void {
	if (settings.showImageInfo === 'none') {
		dom.infoBar.style.display = 'none';
		return;
	}

	dom.infoBar.style.display = 'flex';
	dom.infoBar.className = `halo-hz-info ${settings.showImageInfo}`;

	// Type icon
	const typeIcon = mediaType === 'video' ? '🎬' : '🖼️';

	// Dimensions - prefer passed original dimensions, fallback to element natural size
	let dims = '';
	if (originalW && originalH) {
		dims = `${originalW} × ${originalH}`;
	} else if (mediaType === 'video' && mediaElement instanceof HTMLVideoElement) {
		dims = `${mediaElement.videoWidth} × ${mediaElement.videoHeight}`;
	} else if (mediaElement instanceof HTMLImageElement) {
		dims = `${mediaElement.naturalWidth} × ${mediaElement.naturalHeight}`;
	}

	// Format
	const format = getFormat(source.url, mediaType);

	// File size (try to get from source, or estimate from network if available)
	let sizeStr = '';
	if (source.fileSize && source.fileSize > 0) {
		sizeStr = formatFileSize(source.fileSize);
	}

	// Build meta info: "1920×1080 / JPG / 321.4 KB"
	const metaParts = [dims, format, sizeStr].filter(Boolean);
	const metaText = metaParts.join(' / ');

	dom.infoBar.innerHTML = `<span class="halo-hz-meta">${metaText}</span>`;
}

