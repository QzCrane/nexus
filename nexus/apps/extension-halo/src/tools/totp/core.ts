// goal: TOTP core logic - generate 2FA codes using HMAC-SHA1

import type { TotpEntry, TotpCode } from './types';

// Convert base32 to bytes
function base32ToBytes(base32: string): Uint8Array {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const clean = base32.replace(/[^A-Z2-7]/gi, '').toUpperCase();
	let bits = '';

	for (const char of clean) {
		const val = alphabet.indexOf(char);
		if (val === -1) continue;
		bits += val.toString(2).padStart(5, '0');
	}

	const bytes: number[] = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		bytes.push(parseInt(bits.slice(i, i + 8), 2));
	}

	return new Uint8Array(bytes);
}

// HMAC-SHA1 implementation using Web Crypto API
async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey('raw', key as any, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, data as any);
	return new Uint8Array(sig);
}

// Generate TOTP code
export async function generateTotp(secret: string, digits = 6, period = 30): Promise<TotpCode> {
	const now = Date.now();
	const counter = Math.floor(now / 1000 / period);
	const remaining = period - Math.floor((now / 1000) % period);

	// Convert counter to 8-byte big-endian
	const counterBytes = new Uint8Array(8);
	let temp = counter;
	for (let i = 7; i >= 0; i--) {
		counterBytes[i] = temp & 0xff;
		temp = Math.floor(temp / 256);
	}

	// Get secret bytes
	const secretBytes = base32ToBytes(secret);

	// HMAC-SHA1
	const hmac = await hmacSha1(secretBytes, counterBytes);

	// Dynamic truncation
	const offset = hmac[hmac.length - 1] & 0x0f;
	const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
		((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);

	// Generate code
	const otp = binary % Math.pow(10, digits);
	const code = otp.toString().padStart(digits, '0');

	return { code, remaining, period };
}

// Parse otpauth:// URI
export function parseOtpAuthUri(uri: string): Partial<TotpEntry> | null {
	try {
		const url = new URL(uri);
		if (url.protocol !== 'otpauth:') return null;

		const label = decodeURIComponent(url.pathname.slice(2)); // Remove //totp/
		const [issuer, name] = label.includes(':') ? label.split(':') : ['', label];

		return {
			name: name.trim(),
			issuer: url.searchParams.get('issuer') || issuer.trim(),
			secret: url.searchParams.get('secret') || '',
			digits: parseInt(url.searchParams.get('digits') || '6'),
			period: parseInt(url.searchParams.get('period') || '30'),
		};
	} catch {
		return null;
	}
}

// Generate unique ID
export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Format remaining time
export function formatRemaining(seconds: number): string {
	return `${seconds}s`;
}
