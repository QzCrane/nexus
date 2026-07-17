// goal: Info bar updater for HoverZoom viewer
// eff: Display configurable media info: type icon, dimensions, ratio, scale, format, size, caption, source, hostname

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

/** Calculate aspect ratio in "W:H" format (simplified fraction) or decimal */
function calcRatio(w: number, h: number): string {
	if (!w || !h) return '';
	// Simplify using GCD
	const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
	const d = gcd(w, h);
	const rw = w / d;
	const rh = h / d;
	// If simplified ratio is too large, show decimal instead
	if (rw > 20 || rh > 20) return (w / h).toFixed(2);
	return `${rw}:${rh}`;
}

/** Calculate display scale percentage */
function calcScale(displayW: number, naturalW: number): string {
	if (!displayW || !naturalW) return '';
	const pct = Math.round((displayW / naturalW) * 100);
	return `${pct}%`;
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

	// Get natural dimensions
	let natW = originalW ?? 0;
	let natH = originalH ?? 0;
	if (!natW || !natH) {
		if (mediaType === 'video' && mediaElement instanceof HTMLVideoElement) {
			natW = mediaElement.videoWidth;
			natH = mediaElement.videoHeight;
		} else if (mediaElement instanceof HTMLImageElement) {
			natW = mediaElement.naturalWidth;
			natH = mediaElement.naturalHeight;
		}
	}

	// Dimensions (e.g., 1920 × 1080)
	if (items.dimensions && natW && natH) {
		parts.push(`${natW} × ${natH}`);
	}

	// Ratio (e.g., 16:9 or 1.78)
	if (items.ratio && natW && natH) {
		const r = calcRatio(natW, natH);
		if (r) parts.push(r);
	}

	// Scale (e.g., 50%)
	if (items.scale && mediaElement && natW) {
		const displayW = mediaElement.clientWidth || mediaElement.offsetWidth;
		const s = calcScale(displayW, natW);
		if (s) parts.push(s);
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
	// rule: use textContent — parts include source.caption (attacker-controlled via
	// page <img alt/title>); the previous innerHTML assignment allowed XSS execution
	// in the extension content-script context.
	const metaText = parts.join(' / ');
	dom.infoBar.replaceChildren();
	const span = document.createElement('span');
	span.className = 'halo-hz-meta';
	span.textContent = metaText;
	dom.infoBar.appendChild(span);
}
