// goal: RFC 6238 TOTP with explicit parameters and strict RFC 4648 Base32 input
import type { TotpEntry, TotpCode, TotpAlgorithm } from './types';

const HASHES = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' } as const;

export function base32ToBytes(secret: string): Uint8Array {
	const normalized = secret.replace(/\s/gu, '').toUpperCase();
	if (normalized.length > 1024 || !/^[A-Z2-7]+={0,6}$/u.test(normalized)) throw new Error('Invalid Base32 secret');
	const clean = normalized.replace(/=+$/u, '');
	const remainder = clean.length % 8;
	const padding: Record<number, number> = { 0: 0, 2: 6, 4: 4, 5: 3, 7: 1 };
	if (!(remainder in padding) || (normalized.length !== clean.length && normalized.length - clean.length !== padding[remainder])) {
		throw new Error('Invalid Base32 length or padding');
	}
	const bytes = new Uint8Array(Math.floor(clean.length * 5 / 8));
	let accumulator = 0;
	let bits = 0;
	let index = 0;
	for (const char of clean) {
		accumulator = (accumulator << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes[index++] = accumulator >> bits;
			accumulator &= (1 << bits) - 1;
		}
	}
	if (accumulator !== 0 || bytes.length === 0) throw new Error('Noncanonical Base32 padding bits');
	return bytes;
}

function validateClock(nowMs: number, period: number): void {
	if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(period) || period <= 0) {
		throw new RangeError('TOTP requires nonnegative integer milliseconds and a positive integer period');
	}
}

export function totpCounter(nowMs: number, period = 30): number {
	validateClock(nowMs, period);
	return Math.floor(nowMs / 1000 / period);
}

export function totpRemaining(nowMs: number, period = 30): number {
	validateClock(nowMs, period);
	return period - Math.floor((nowMs / 1000) % period);
}

export async function generateTotp(
	secret: string, digits = 6, period = 30, nowMs = Date.now(), algorithm: TotpAlgorithm = 'SHA1',
): Promise<TotpCode> {
	if (!Number.isInteger(digits) || digits < 6 || digits > 8 || !Object.hasOwn(HASHES, algorithm)) {
		throw new RangeError('Unsupported TOTP digits or HMAC algorithm');
	}
	let counter = BigInt(totpCounter(nowMs, period));
	const counterBytes = new Uint8Array(8);
	for (let index = 7; index >= 0; index -= 1) {
		counterBytes[index] = Number(counter & 255n);
		counter >>= 8n;
	}
	const key = await crypto.subtle.importKey('raw', base32ToBytes(secret) as BufferSource,
		{ name: 'HMAC', hash: HASHES[algorithm] }, false, ['sign']);
	const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));
	const offset = (hmac.at(-1) ?? 0) & 15;
	const binary = new DataView(hmac.buffer, hmac.byteOffset + offset, 4).getUint32(0) & 0x7fffffff;
	return { code: String(binary % 10 ** digits).padStart(digits, '0'), remaining: totpRemaining(nowMs, period), period };
}

export function parseOtpAuthUri(uri: string): Partial<TotpEntry> | null {
	try {
		const url = new URL(uri);
		if (url.protocol !== 'otpauth:' || url.hostname !== 'totp' || url.port || url.username || url.password || url.hash) return null;
		const parameters = url.searchParams;
		for (const key of ['secret', 'issuer', 'algorithm', 'digits', 'period']) if (parameters.getAll(key).length > 1) return null;
		if (parameters.has('counter')) return null;
		const label = decodeURIComponent(url.pathname.slice(1)).trim();
		const separator = label.indexOf(':');
		const labelIssuer = separator < 0 ? '' : label.slice(0, separator).trim();
		const name = separator < 0 ? label : label.slice(separator + 1).trim();
		const issuer = (parameters.get('issuer') ?? labelIssuer).trim();
		if (!name || (labelIssuer && issuer !== labelIssuer)) return null;
		const secret = (parameters.get('secret') ?? '').replace(/\s/gu, '').toUpperCase();
		base32ToBytes(secret);
		const algorithm = (parameters.get('algorithm') ?? 'SHA1').toUpperCase();
		if (!Object.hasOwn(HASHES, algorithm)) return null;
		const digitsText = parameters.get('digits') ?? '6';
		const periodText = parameters.get('period') ?? '30';
		if (!/^[6-8]$/u.test(digitsText) || !/^[1-9]\d*$/u.test(periodText)) return null;
		const digits = Number(digitsText);
		const period = Number(periodText);
		validateClock(0, period);
		return { name, issuer, secret, digits, period, algorithm: algorithm as TotpAlgorithm };
	} catch {
		return null;
	}
}

export function generateId(): string { return crypto.randomUUID(); }
export function formatRemaining(seconds: number): string { return `${seconds}s`; }
