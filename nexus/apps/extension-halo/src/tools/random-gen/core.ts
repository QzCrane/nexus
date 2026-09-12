import { generateULID as canonicalULID } from '../uuid/core';

export const MAX_RANDOM_BYTE_LENGTH = 16 * 1024 * 1024;

// goal: Random Generator core logic

// Generate cryptographically strong random bytes
export function getRandomBytes(length: number): Uint8Array {
	if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RANDOM_BYTE_LENGTH) {
		throw new RangeError('Random output must be between zero and 16 MiB');
	}
	const arr = new Uint8Array(length);
	for (let offset = 0; offset < arr.length; offset += 65_536) {
		crypto.getRandomValues(arr.subarray(offset, offset + 65_536));
	}
	return arr;
}

// Generate Hex string
export function generateHex(length: number): string {
	const bytes = getRandomBytes(Math.ceil(length / 2));
	return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

// Generate Base64 string
export function generateBase64(length: number): string {
	const bytes = getRandomBytes(length); // Approximate
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).slice(0, length);
}

// Generate UUID v4
export function generateUUID(): string {
	return crypto.randomUUID();
}

// Use the same canonical Crockford Base32 ULID layout as the UUID tool.
export function generateULID(): string {
	return canonicalULID();
}
