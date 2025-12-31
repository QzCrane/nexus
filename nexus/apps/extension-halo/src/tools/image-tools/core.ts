// goal: Image Tools core logic - compress and convert images using canvas

import type { ImageFormat, ImageConfig, ImageInfo } from './types';

// Load image from file
export function loadImage(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = URL.createObjectURL(file);
	});
}

// Get image info
export function getImageInfo(file: File, img: HTMLImageElement): ImageInfo {
	return {
		width: img.naturalWidth,
		height: img.naturalHeight,
		size: file.size,
		type: file.type,
	};
}

// Compress/convert image
export async function processImage(img: HTMLImageElement, config: ImageConfig): Promise<Blob> {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d')!;

	// Calculate new dimensions
	let { width, height } = img;
	const ratio = width / height;

	if (config.maxWidth && width > config.maxWidth) {
		width = config.maxWidth;
		height = width / ratio;
	}
	if (config.maxHeight && height > config.maxHeight) {
		height = config.maxHeight;
		width = height * ratio;
	}

	canvas.width = Math.round(width);
	canvas.height = Math.round(height);

	// Draw image
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

	// Convert to blob
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new Error('Failed to process image'));
			},
			`image/${config.format}`,
			config.quality
		);
	});
}

// Image to Base64
export function imageToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

// Base64 to Blob
export function base64ToBlob(base64: string): Blob {
	const [header, data] = base64.split(',');
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
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
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
