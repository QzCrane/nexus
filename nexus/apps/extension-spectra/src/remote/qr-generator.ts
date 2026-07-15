/**
 * SPECTRA Remote - QR Generator
 */

import QRCode from 'qrcode';
import { getRemoteUrl } from './constants.js';
import type { RemotePairing } from './protocol';

export async function generateRemoteQR(pairing: RemotePairing, baseUrl?: string): Promise<string> {
	const url = getRemoteUrl(pairing, baseUrl);

	return QRCode.toDataURL(url, {
		width: 200,
		margin: 2,
		color: {
			dark: '#1a1a2e',
			light: '#ffffff',
		},
	});
}

// For debugging
export async function generateRemoteQRText(pairing: RemotePairing): Promise<string> {
	return QRCode.toString(getRemoteUrl(pairing), { type: 'terminal', small: true });
}
