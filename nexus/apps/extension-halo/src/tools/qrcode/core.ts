// goal: QR Code generation core logic

import QRCode from 'qrcode';
import type { QRCodeOptions } from './types';
import { DEFAULT_OPTIONS } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';

type StoredQrOptions = Omit<QRCodeOptions, 'text'>;
const LEVELS = new Set(['L', 'M', 'Q', 'H']);
export const qrcodeOptionsCodec: ToolStateCodec<StoredQrOptions> = {
	decode(value) {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return { kind: 'invalid', reason: 'QR options are not a record.' };
		const options = value as Record<string, unknown>;
		if (!Number.isSafeInteger(options.size) || (options.size as number) < 64 || (options.size as number) > 2_048
			|| !Number.isSafeInteger(options.margin) || (options.margin as number) < 0 || (options.margin as number) > 32
			|| typeof options.errorCorrectionLevel !== 'string' || !LEVELS.has(options.errorCorrectionLevel)
			|| typeof options.darkColor !== 'string' || !/^#[0-9a-f]{6}$/iu.test(options.darkColor)
			|| typeof options.lightColor !== 'string' || !/^#[0-9a-f]{6}$/iu.test(options.lightColor)
			|| (options.logo !== undefined && (typeof options.logo !== 'string' || options.logo.length > 4 * 1024 * 1024))
			|| (options.logoSize !== undefined && (typeof options.logoSize !== 'number' || !Number.isFinite(options.logoSize) || options.logoSize < 0.1 || options.logoSize > 0.3))) {
			return { kind: 'invalid', reason: 'QR size, margin, colors, correction level, or logo are invalid.' };
		}
		return { kind: 'valid', value: options as unknown as StoredQrOptions };
	},
	encode: (value) => value,
};

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
