// goal: Type definitions for media-sniffer tool

export type MediaType = 'video' | 'audio' | 'image';

export interface MediaItem {
	id: string;
	url: string;
	type: MediaType;
	/** e.g. mp4, webm, mp3, jpg */
	ext: string;
	/** File size in bytes (0 if unknown) */
	size: number;
	/** Source element tag */
	source: 'video' | 'audio' | 'img' | 'source' | 'picture' | 'background';
	/** Human readable size */
	sizeText: string;
	/** Video/image dimensions if available */
	width?: number;
	height?: number;
	/** Duration in seconds for video/audio */
	duration?: number;
}

export interface ScanResult {
	items: MediaItem[];
	timestamp: number;
	url: string;
}

export interface FilterConfig {
	types: Set<MediaType>;
	minSize: number;
	includeDataUrls: boolean;
}
