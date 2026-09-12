import { paletteFromPixels } from '../color-palette/core';
import { parseExif } from '../exif-reader/core';
import type { ImageConfig, ImageInfo } from './types';
import {
	IMAGE_MAX_DECODED_PIXELS,
	IMAGE_MAX_INPUT_BYTES,
	IMAGE_MAX_OUTPUT_BYTES,
	type ImageWorkerRequest,
	type ImageWorkerResponse,
} from './worker-contract';

function assertFile(file: File): void {
	if (file.size <= 0) throw new Error('The selected image is empty.');
	if (file.size > IMAGE_MAX_INPUT_BYTES) throw new Error('The selected image exceeds the 32 MiB input limit.');
}

function imageInfo(file: File, bitmap: ImageBitmap): ImageInfo {
	const pixels = bitmap.width * bitmap.height;
	if (!Number.isSafeInteger(pixels) || pixels <= 0) throw new Error('The image has invalid decoded dimensions.');
	if (pixels > IMAGE_MAX_DECODED_PIXELS) throw new Error('The image exceeds the 32 megapixel decoded-pixel limit.');
	return { width: bitmap.width, height: bitmap.height, size: file.size, type: file.type };
}

async function withBitmap<T>(file: File, use: (bitmap: ImageBitmap, info: ImageInfo) => Promise<T> | T): Promise<T> {
	assertFile(file);
	const bitmap = await createImageBitmap(file);
	try {
		return await use(bitmap, imageInfo(file, bitmap));
	} finally {
		bitmap.close();
	}
}

function outputDimensions(info: ImageInfo, config: ImageConfig): { width: number; height: number } {
	let { width, height } = info;
	const ratio = width / height;
	if (config.maxWidth > 0 && width > config.maxWidth) {
		width = config.maxWidth;
		height = width / ratio;
	}
	if (config.maxHeight > 0 && height > config.maxHeight) {
		height = config.maxHeight;
		width = height * ratio;
	}
	width = Math.max(1, Math.round(width));
	height = Math.max(1, Math.round(height));
	if (width * height > IMAGE_MAX_DECODED_PIXELS) throw new Error('Requested output exceeds the 32 megapixel limit.');
	return { width, height };
}

async function processImage(file: File, config: ImageConfig): Promise<Extract<ImageWorkerResponse, { type: 'process' }>> {
	if (!['png', 'jpeg', 'webp'].includes(config.format)) throw new Error('Unsupported output image format.');
	if (!Number.isFinite(config.quality) || config.quality < 0.1 || config.quality > 1) throw new Error('Image quality must be between 0.1 and 1.');
	return withBitmap(file, async (bitmap, info) => {
		const size = outputDimensions(info, config);
		const canvas = new OffscreenCanvas(size.width, size.height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Offscreen Canvas 2D context is unavailable.');
		context.drawImage(bitmap, 0, 0, size.width, size.height);
		const blob = await canvas.convertToBlob({ type: `image/${config.format}`, quality: config.quality });
		if (blob.size > IMAGE_MAX_OUTPUT_BYTES) throw new Error('Processed image exceeds the 64 MiB output limit.');
		return { ok: true, type: 'process', blob, info };
	});
}

async function extractPalette(file: File, maxColors: number): Promise<Extract<ImageWorkerResponse, { type: 'palette' }>> {
	return withBitmap(file, (bitmap, info) => {
		const scale = Math.min(1, 100 / Math.max(bitmap.width, bitmap.height));
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Offscreen Canvas 2D context is unavailable.');
		context.drawImage(bitmap, 0, 0, width, height);
		const pixels = context.getImageData(0, 0, width, height).data;
		return { ok: true, type: 'palette', colors: paletteFromPixels(pixels, maxColors), info };
	});
}

export async function handleImageWorkerRequest(request: ImageWorkerRequest): Promise<ImageWorkerResponse> {
	try {
		switch (request.type) {
			case 'inspect':
				return await withBitmap(request.file, (_bitmap, info) => ({ ok: true, type: 'inspect', info }));
			case 'process':
				return await processImage(request.file, request.config);
			case 'palette':
				return await extractPalette(request.file, request.maxColors);
			case 'exif': {
				return await withBitmap(request.file, async () => ({
					ok: true,
					type: 'exif',
					data: parseExif(await request.file.arrayBuffer()),
				}));
			}
		}
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

const workerScope = globalThis as unknown as {
	addEventListener?: (type: 'message', listener: (event: MessageEvent<ImageWorkerRequest>) => void) => void;
	postMessage?: (message: ImageWorkerResponse) => void;
};
if (typeof document === 'undefined' && workerScope.addEventListener && workerScope.postMessage) {
	workerScope.addEventListener('message', (event) => {
		void handleImageWorkerRequest(event.data).then((response) => workerScope.postMessage?.(response));
	});
}
