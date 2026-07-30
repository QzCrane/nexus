// goal: Core logic for media detection and extraction

import type { MediaItem, MediaType, FilterConfig } from './types';

// Extension to type mapping
const EXT_MAP: Record<string, MediaType> = {
	// Video
	mp4: 'video', webm: 'video', ogg: 'video', ogv: 'video', avi: 'video',
	mov: 'video', mkv: 'video', m3u8: 'video', ts: 'video', flv: 'video',
	// Audio
	mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', m4a: 'audio', oga: 'audio',
	// Image
	jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
	svg: 'image', bmp: 'image', ico: 'image', avif: 'image',
};

// MIME to extension mapping
const MIME_MAP: Record<string, string> = {
	'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogg',
	'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'oga',
	'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
	'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
};

/** Extract extension from URL or default to empty */
export function getExtFromUrl(url: string): string {
	try {
		const pathname = new URL(url).pathname;
		const match = pathname.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
		return match?.[1]?.toLowerCase() ?? '';
	} catch {
		return '';
	}
}

/** Detect media type from extension or MIME */
export function detectMediaType(ext: string, mime?: string): MediaType | null {
	if (mime && MIME_MAP[mime]) return EXT_MAP[MIME_MAP[mime]] || null;
	return EXT_MAP[ext] || null;
}

/** Format file size to human readable */
export function formatSize(bytes: number): string {
	if (bytes === 0) return '?';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Generate unique ID for media item */
export function generateId(): string {
	return Math.random().toString(36).slice(2, 10);
}

/** Create MediaItem from URL */
export function createMediaItem(
	url: string,
	source: MediaItem['source'],
	meta?: { size?: number; width?: number; height?: number; duration?: number }
): MediaItem | null {
	const ext = getExtFromUrl(url);
	const type = detectMediaType(ext);
	if (!type) return null;

	const size = meta?.size ?? 0;
	return {
		id: generateId(),
		url,
		type,
		ext,
		size,
		source,
		sizeText: formatSize(size),
		width: meta?.width,
		height: meta?.height,
		duration: meta?.duration,
	};
}

/** Filter and dedupe media items */
export function filterMedia(items: MediaItem[], config: FilterConfig): MediaItem[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		// Skip duplicates
		if (seen.has(item.url)) return false;
		seen.add(item.url);
		// Type filter
		if (!config.types.includes(item.type)) return false;
		// Size filter
		if (item.size > 0 && item.size < config.minSize) return false;
		// Data URL filter
		if (!config.includeDataUrls && item.url.startsWith('data:')) return false;
		return true;
	});
}

/** Download file from URL */
export async function downloadMedia(url: string, filename?: string): Promise<void> {
	// Use chrome.downloads API if available
	if (typeof chrome !== 'undefined' && chrome.downloads) {
		await chrome.downloads.download({ url, filename, saveAs: true });
	} else {
		// Fallback: open in new tab
		window.open(url, '_blank');
	}
}

/** Get filename from URL */
export function getFilename(url: string): string {
	try {
		const pathname = new URL(url).pathname;
		const parts = pathname.split('/');
		return parts[parts.length - 1] || 'media';
	} catch {
		return 'media';
	}
}
