// goal: QR Code scanning logic

import jsQR from 'jsqr';
import type { ScanResult } from './types';

export function scanQRCodeFromImageData(imageData: ImageData): ScanResult | null {
	const code = jsQR(imageData.data, imageData.width, imageData.height);
	if (!code) return null;
	return {
		data: code.data,
		location: {
			topLeft: code.location.topLeftCorner,
			topRight: code.location.topRightCorner,
			bottomLeft: code.location.bottomLeftCorner,
			bottomRight: code.location.bottomRightCorner,
		},
	};
}

export async function scanQRCodeFromFile(file: File): Promise<ScanResult | null> {
	return new Promise((resolve) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = img.width; canvas.height = img.height;
			const ctx = canvas.getContext('2d');
			if (!ctx) { URL.revokeObjectURL(url); resolve(null); return; }
			ctx.drawImage(img, 0, 0);
			const result = scanQRCodeFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
			URL.revokeObjectURL(url);
			resolve(result);
		};
		img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
		img.src = url;
	});
}

export async function scanQRCodeFromClipboard(): Promise<ScanResult | null> {
	try {
		const items = await navigator.clipboard.read();
		for (const item of items) {
			const imageType = item.types.find(t => t.startsWith('image/'));
			if (imageType) {
				const blob = await item.getType(imageType);
				return scanQRCodeFromFile(new File([blob], 'clip.png', { type: imageType }));
			}
		}
	} catch { }
	return null;
}
