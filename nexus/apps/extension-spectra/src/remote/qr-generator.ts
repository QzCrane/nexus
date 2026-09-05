// goal: render the authenticated pairing URL with the local QR encoder

import { getRemoteUrl } from './constants.js';
import { renderQrSvg } from './qr-encoder';
import type { RemotePairing } from './protocol';

export async function generateRemoteQR(pairing: RemotePairing, baseUrl?: string): Promise<string> {
	const url = getRemoteUrl(pairing, baseUrl);
	const svg = renderQrSvg(url);
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
