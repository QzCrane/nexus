// goal: TOTP core logic - generate 2FA codes using HMAC-SHA1

import type { TotpEntry, TotpCode } from './types';

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

async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key as BufferSource,
		{ name: 'HMAC', hash: 'SHA-1' },
		false,
		['sign'],
	);
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, data as BufferSource);
	return new Uint8Array(sig);
}

export function totpCounter(nowMs: number, period = 30): number {
	return Math.floor(nowMs / 1000 / period);
}

export function totpRemaining(nowMs: number, period = 30): number {
	return period - Math.floor((nowMs / 1000) % period);
}

// Generate one code for one counter epoch. Supplying nowMs lets the caller use
// exactly the same clock sample for cache admission and remaining-time display.
export async function generateTotp(
	secret: string,
	digits = 6,
	period = 30,
	nowMs = Date.now(),
): Promise<TotpCode> {
	const counter = totpCounter(nowMs, period);
	const remaining = totpRemaining(nowMs, period);

	const counterBytes = new Uint8Array(8);
	let temp = counter;
	for (let i = 7; i >= 0; i--) {
		counterBytes[i] = temp & 0xff;
		temp = Math.floor(temp / 256);
	}

	const secretBytes = base32ToBytes(secret);
	const hmac = await hmacSha1(secretBytes, counterBytes);

	const finalByte = hmac.at(-1);
	if (hmac.length < 20 || finalByte === undefined) {
		throw new Error('Invalid HMAC-SHA1 output length');
	}
	const offset = finalByte & 0x0f;
	const chunk = hmac.slice(offset, offset + 4);
	if (chunk.length !== 4) throw new Error('Invalid HMAC-SHA1 truncation offset');
	const [first, second, third, fourth] = chunk;
	if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
		throw new Error('Invalid HMAC-SHA1 truncation bytes');
	}
	const binary = ((first & 0x7f) << 24) | ((second & 0xff) << 16)
		| ((third & 0xff) << 8) | (fourth & 0xff);

	const otp = binary % 10 ** digits;
	const code = otp.toString().padStart(digits, '0');

	return { code, remaining, period };
}

export function parseOtpAuthUri(uri: string): Partial<TotpEntry> | null {
	try {
		const url = new URL(uri);
		if (url.protocol !== 'otpauth:') return null;

		const label = decodeURIComponent(url.pathname.slice(2));
		const parts = label.split(':');
		const issuer = parts.length > 1 ? (parts[0] ?? '') : '';
		const name = parts.length > 1 ? (parts[1] ?? '') : label;

		return {
			name: name.trim(),
			issuer: url.searchParams.get('issuer') || issuer.trim(),
			secret: url.searchParams.get('secret') || '',
			digits: parseInt(url.searchParams.get('digits') || '6', 10),
			period: parseInt(url.searchParams.get('period') || '30', 10),
		};
	} catch {
		return null;
	}
}

export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function formatRemaining(seconds: number): string {
	return `${seconds}s`;
}
