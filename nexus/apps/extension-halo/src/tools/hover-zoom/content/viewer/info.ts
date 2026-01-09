// goal: Info bar updater for HoverZoom viewer
// eff: Display configurable media info: type icon, dimensions, format, size, caption, source, hostname

import type { ViewerDOM } from '../viewer-dom';
import type { EnhancedResult } from '../resolvers/rule-resolver';
import type { HoverZoomSettings } from '../../types';

/** Format file size to human readable string */
function formatFileSize(bytes: number): string {
	if (bytes <= 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Extract format from URL or content type */
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

/** Extract hostname from URL */
function getHostname(url: string): string {
	try {
		return new URL(url).hostname.replace('www.', '');
	} catch {
		return '';
	}
}

/**
 * Update the info bar with current media information.
 * Respects imageInfoItems settings for each field.
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

	const items = settings.imageInfoItems;
	const parts: string[] = [];

	// Type icon (🖼️ / 🎬)
	if (items.typeIcon) {
		parts.push(mediaType === 'video' ? '🎬' : '🖼️');
	}

	// Dimensions (e.g., 1920 × 1080)
	if (items.dimensions) {
		let dims = '';
		if (originalW && originalH) {
			dims = `${originalW} × ${originalH}`;
		} else if (mediaType === 'video' && mediaElement instanceof HTMLVideoElement) {
			dims = `${mediaElement.videoWidth} × ${mediaElement.videoHeight}`;
		} else if (mediaElement instanceof HTMLImageElement) {
			dims = `${mediaElement.naturalWidth} × ${mediaElement.naturalHeight}`;
		}
		if (dims) parts.push(dims);
	}

	// Format (e.g., JPG, PNG)
	if (items.format) {
		const format = getFormat(source.url, mediaType);
		if (format) parts.push(format);
	}

	// File size (e.g., 321.4 KB)
	if (items.size && source.fileSize && source.fileSize > 0) {
		parts.push(formatFileSize(source.fileSize));
	}

	// Caption (alt/title)
	if (items.caption && source.caption) {
		parts.push(source.caption);
	}

	// Source (rule that matched: engine, engine:fallback, etc.)
	if (items.source && source.fromRule) {
		parts.push(`[${source.fromRule}]`);
	}

	// Hostname (image host domain)
	if (items.hostname) {
		const host = getHostname(source.url);
		if (host) parts.push(host);
	}

	// Build meta info with separator
	const metaText = parts.join(' / ');
	dom.infoBar.innerHTML = `<span class="halo-hz-meta">${metaText}</span>`;
}
