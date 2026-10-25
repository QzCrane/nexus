import { describe, expect, test } from 'bun:test';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { getRemoteUrl } from '../src/remote/constants';
import { isSafeRemoteQrDataUrl } from '../src/remote/modal-renderer';
import { createRemotePairing } from '../src/remote/protocol';
import { generateRemoteQR } from '../src/remote/qr-generator';

const SVG_PREFIX = 'data:image/svg+xml;charset=utf-8,';

function decodeSvgDataUrl(dataUrl: string): string {
	expect(dataUrl.startsWith(SVG_PREFIX)).toBe(true);
	return decodeURIComponent(dataUrl.slice(SVG_PREFIX.length));
}

async function scanQrDataUrl(dataUrl: string): Promise<string | null> {
	const { data, info } = await sharp(Buffer.from(decodeSvgDataUrl(dataUrl)), { density: 1440 })
		.resize(720, 720, { fit: 'fill' })
		.flatten({ background: '#ffffff' })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

describe('remote pairing QR', () => {
	test('encodes the exact authenticated pairing URL and scans back', async () => {
		const baseUrl = 'https://remote.example.test';
		const pairing = createRemotePairing();
		const qr = await generateRemoteQR(pairing, baseUrl);
		expect(await scanQrDataUrl(qr)).toBe(getRemoteUrl(pairing, baseUrl));
		expect(decodeSvgDataUrl(qr)).not.toContain(pairing.secret);
	});

	test('keeps encoding payloads beyond the retired 213-byte version-10 boundary', async () => {
		const baseUrl = `https://remote.example.test/${'segment/'.repeat(30)}`;
		const pairing = createRemotePairing();
		const url = getRemoteUrl(pairing, baseUrl);
		expect(url.length).toBeGreaterThan(213);
		expect(await scanQrDataUrl(await generateRemoteQR(pairing, baseUrl))).toBe(url);
	});

	test('produces a local sanitizer-compatible SVG image', async () => {
		const qr = await generateRemoteQR(createRemotePairing());
		const svg = decodeSvgDataUrl(qr);
		expect(svg.startsWith('<svg ')).toBe(true);
		expect(svg).toContain('viewBox="0 0 ');
		expect(svg).toContain('fill="#ffffff"');
		expect(svg).toContain('<path ');
		expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
		expect(isSafeRemoteQrDataUrl(qr)).toBe(true);
	});
});
