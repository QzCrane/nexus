// goal: QR Code generation core logic

import QRCode from 'qrcode';
import type { QRCodeOptions } from './types';
import { DEFAULT_OPTIONS } from './types';

export async function generateQRCode(text: string, options: Partial<Omit<QRCodeOptions, 'text'>> = {}): Promise<string> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const canvas = document.createElement('canvas');
	await QRCode.toCanvas(canvas, text, {
		width: opts.size, margin: opts.margin, errorCorrectionLevel: opts.errorCorrectionLevel,
		color: { dark: opts.darkColor, light: opts.lightColor },
	});

	if (opts.logo) {
		const ctx = canvas.getContext('2d');
		if (ctx) {
			const logoImg = new Image();
			logoImg.src = opts.logo;
			await new Promise((r) => { logoImg.onload = r; logoImg.onerror = r; });
			if (logoImg.complete && logoImg.width > 0) {
				const logoSize = opts.size * (opts.logoSize || 0.2);
				const x = (opts.size - logoSize) / 2, y = (opts.size - logoSize) / 2;
				ctx.fillStyle = opts.lightColor;
				ctx.fillRect(x - 2, y - 2, logoSize + 4, logoSize + 4);
				ctx.drawImage(logoImg, x, y, logoSize, logoSize);
			}
		}
	}
	return canvas.toDataURL('image/png');
}

export async function generateSVG(text: string, options: Partial<Omit<QRCodeOptions, 'text'>> = {}): Promise<string> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	return QRCode.toString(text, {
		type: 'svg', margin: opts.margin, errorCorrectionLevel: opts.errorCorrectionLevel,
		color: { dark: opts.darkColor, light: opts.lightColor },
	});
}
