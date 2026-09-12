// goal: QR Code scanning logic

import jsQR from 'jsqr';
import type { ScanResult } from './types';
import { createObjectUrlLease } from '../../kernel/utils/object-url-lease';

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

export async function scanQRCodeFromFile(file: File, signal?: AbortSignal): Promise<ScanResult | null> {
	return new Promise((resolve) => {
		const img = new Image();
		const lease = createObjectUrlLease(file);
		let settled = false;
		const finish = (result: ScanResult | null): void => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener('abort', abort);
			lease.release();
			resolve(result);
		};
		const abort = (): void => { img.src = ''; finish(null); };
		if (signal?.aborted) { abort(); return; }
		signal?.addEventListener('abort', abort, { once: true });
		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = img.width; canvas.height = img.height;
			const ctx = canvas.getContext('2d');
			if (!ctx) { finish(null); return; }
			ctx.drawImage(img, 0, 0);
			const result = scanQRCodeFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
			finish(result);
		};
		img.onerror = () => finish(null);
		img.src = lease.url;
	});
}

export async function scanQRCodeFromClipboard(signal?: AbortSignal): Promise<ScanResult | null> {
	try {
		const items = await navigator.clipboard.read();
		for (const item of items) {
			const imageType = item.types.find(t => t.startsWith('image/'));
			if (imageType) {
				const blob = await item.getType(imageType);
				return scanQRCodeFromFile(new File([blob], 'clip.png', { type: imageType }), signal);
			}
		}
	} catch (error: unknown) {
		console.warn('[HALO:QRCode] Clipboard image read failed', error);
		return null;
	}
	return null;
}
