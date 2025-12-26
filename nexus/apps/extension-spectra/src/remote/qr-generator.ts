/**
 * SPECTRA Remote - QR 码生成器
 */

import QRCode from 'qrcode';

/** 遥控页面默认 URL */
const DEFAULT_REMOTE_URL = 'https://nexus-remote.pages.dev';

/**
 * 生成遥控二维码
 * @param sessionId 会话 ID
 * @param baseUrl 可选，遥控页面基础 URL
 * @returns Base64 Data URL
 */
export async function generateRemoteQR(sessionId: string, baseUrl?: string): Promise<string> {
	const base = baseUrl || DEFAULT_REMOTE_URL;
	const url = `${base}?s=${sessionId}`;

	return QRCode.toDataURL(url, {
		width: 200,
		margin: 2,
		color: {
			dark: '#1a1a2e',
			light: '#ffffff',
		},
	});
}

/**
 * 生成纯文本二维码 (用于调试)
 */
export async function generateRemoteQRText(sessionId: string): Promise<string> {
	const url = `${DEFAULT_REMOTE_URL}?s=${sessionId}`;
	return QRCode.toString(url, { type: 'terminal', small: true });
}
