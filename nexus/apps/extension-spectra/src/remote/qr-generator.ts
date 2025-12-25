/**
 * SPECTRA Remote - QR 码生成器
 */

import QRCode from 'qrcode';

/** 遥控页面 URL 前缀 (可配置) */
const REMOTE_PAGE_BASE = 'https://spectra-remote.pages.dev';

/**
 * 生成遥控二维码
 * @param sessionId 会话 ID
 * @returns Base64 Data URL
 */
export async function generateRemoteQR(sessionId: string): Promise<string> {
	const url = `${REMOTE_PAGE_BASE}?s=${sessionId}`;

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
	const url = `${REMOTE_PAGE_BASE}?s=${sessionId}`;
	return QRCode.toString(url, { type: 'terminal', small: true });
}
