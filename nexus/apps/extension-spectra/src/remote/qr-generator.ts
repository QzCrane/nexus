// goal: render the authenticated pairing URL as a scannable SVG data URL using the admitted QR encoder

import QRCode from 'qrcode';
import { UI_COLORS } from '../shared/ui-colors';
import { getRemoteUrl } from './constants.js';
import type { RemotePairing } from './protocol';

export async function generateRemoteQR(pairing: RemotePairing, baseUrl?: string): Promise<string> {
	const url = getRemoteUrl(pairing, baseUrl);
	const svg = await QRCode.toString(url, {
		type: 'svg',
		errorCorrectionLevel: 'M',
		margin: 4,
		color: { dark: UI_COLORS.QR_DARK, light: UI_COLORS.QR_LIGHT },
	});
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
