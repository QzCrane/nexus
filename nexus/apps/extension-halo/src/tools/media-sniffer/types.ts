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
	types: MediaType[];
	minSize: number;
	includeDataUrls: boolean;
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
	types: ['video', 'audio', 'image'],
	minSize: 0,
	includeDataUrls: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMediaType(value: unknown): value is MediaType {
	return value === 'video' || value === 'audio' || value === 'image';
}

function isMediaSource(value: unknown): value is MediaItem['source'] {
	return value === 'video'
		|| value === 'audio'
		|| value === 'img'
		|| value === 'source'
		|| value === 'picture'
		|| value === 'background';
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isOptionalFiniteNonNegativeNumber(
	value: unknown,
): value is number | undefined {
	return value === undefined || isFiniteNonNegativeNumber(value);
}

function isMediaItem(value: unknown): value is MediaItem {
	if (!isRecord(value)) return false;

	return typeof value.id === 'string'
		&& typeof value.url === 'string'
		&& isMediaType(value.type)
		&& typeof value.ext === 'string'
		&& isFiniteNonNegativeNumber(value.size)
		&& isMediaSource(value.source)
		&& typeof value.sizeText === 'string'
		&& isOptionalFiniteNonNegativeNumber(value.width)
		&& isOptionalFiniteNonNegativeNumber(value.height)
		&& isOptionalFiniteNonNegativeNumber(value.duration);
}

export function isScanResult(value: unknown): value is ScanResult {
	return isRecord(value)
		&& Array.isArray(value.items)
		&& value.items.every(isMediaItem)
		&& isFiniteNonNegativeNumber(value.timestamp)
		&& typeof value.url === 'string';
}

export function normalizeScanResult(value: unknown): ScanResult | null {
	return isScanResult(value) ? value : null;
}

export function normalizeFilterConfig(value: unknown): FilterConfig {
	if (!isRecord(value)) return { ...DEFAULT_FILTER_CONFIG, types: [...DEFAULT_FILTER_CONFIG.types] };

	const types = Array.isArray(value.types)
		? Array.from(new Set(value.types.filter(isMediaType)))
		: [...DEFAULT_FILTER_CONFIG.types];

	return {
		types,
		minSize: typeof value.minSize === 'number' && Number.isFinite(value.minSize)
			? Math.max(0, value.minSize)
			: DEFAULT_FILTER_CONFIG.minSize,
		includeDataUrls: typeof value.includeDataUrls === 'boolean'
			? value.includeDataUrls
			: DEFAULT_FILTER_CONFIG.includeDataUrls,
	};
}
