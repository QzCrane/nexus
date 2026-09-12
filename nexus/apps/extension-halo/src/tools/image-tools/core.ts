// goal: Image Tools core logic - compress and convert images using canvas

import type { ImageConfig } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { downloadBlob as downloadOwnedBlob } from '../../kernel/utils/object-url-lease';
import type { OwnedTaskExecution } from '../../kernel/utils/owned-async-task';

const IMAGE_FORMATS = new Set(['png', 'jpeg', 'webp']);

export const imageToolsConfigCodec: ToolStateCodec<ImageConfig> = {
	decode(value) {
		const raw = typeof value === 'object' && value !== null && !Array.isArray(value)
			&& (value as Record<string, unknown>).version === 1
			? (value as Record<string, unknown>).value
			: value;
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'invalid', reason: 'Image configuration is not a record.' };
		const config = raw as Record<string, unknown>;
		if (typeof config.format !== 'string' || !IMAGE_FORMATS.has(config.format)
			|| typeof config.quality !== 'number' || !Number.isFinite(config.quality) || config.quality < 0.1 || config.quality > 1
			|| !Number.isSafeInteger(config.maxWidth) || (config.maxWidth as number) < 0 || (config.maxWidth as number) > 32_768
			|| !Number.isSafeInteger(config.maxHeight) || (config.maxHeight as number) < 0 || (config.maxHeight as number) > 32_768) {
			return { kind: 'invalid', reason: 'Image format, quality, or dimension limits are invalid.' };
		}
		return { kind: 'valid', value: config as unknown as ImageConfig };
	},
	encode(value) { return { version: 1, value }; },
};

// Image to Base64
export function imageToBase64(blob: Blob): OwnedTaskExecution<string> {
	const reader = new FileReader();
	const promise = new Promise<string>((resolve, reject) => {
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error ?? new Error('Image read failed'));
		reader.onabort = () => reject(new DOMException('Image read cancelled', 'AbortError'));
		reader.readAsDataURL(blob);
	});
	return {
		promise,
		dispose: () => {
			if (reader.readyState === FileReader.LOADING) reader.abort();
		},
	};
}

// Base64 to Blob
export function base64ToBlob(base64: string): Blob {
	const [header, data] = base64.split(',');
	if (header === undefined || data === undefined) {
		throw new Error('Invalid base64 data URL');
	}
	const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
	const binary = atob(data);
	const array = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		array[i] = binary.charCodeAt(i);
	}
	return new Blob([array], { type: mime });
}

// Download blob
export function downloadBlob(blob: Blob, filename: string): void {
	downloadOwnedBlob(blob, filename);
}

// Format file size
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}

// Default config
export const DEFAULT_CONFIG: ImageConfig = {
	quality: 0.8,
	maxWidth: 0,
	maxHeight: 0,
	format: 'jpeg',
};
