// goal: Hash generation core logic with MD5, HMAC, and verification support
// note: MD5 is delegated to the repository-wide owner in kernel/utils/md5.ts.

import { md5Bytes, md5Text } from '../../kernel/utils/md5';
import type { HashAlgorithm, VerifyResult } from './types';

// Map algorithm names to Web Crypto format
function getWebCryptoAlgorithm(algo: HashAlgorithm): string {
	if (algo === 'MD5') return 'MD5'; // Handled separately
	return algo; // SHA-1, SHA-256, SHA-384, SHA-512
}

/**
 * Generate hash for text
 */
export async function generateHash(text: string, algorithm: HashAlgorithm): Promise<string> {
	if (!text) return '';

	// MD5 uses the repository-wide owner
	if (algorithm === 'MD5') {
		return md5Text(text);
	}

	const encoder = new TextEncoder();
	const data = encoder.encode(text);

	try {
		const hashBuffer = await crypto.subtle.digest(getWebCryptoAlgorithm(algorithm), data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	} catch (error) {
		console.error('[Hash] Generation failed', error);
		return '';
	}
}

/**
 * Generate HMAC for text
 */
export async function generateHMAC(text: string, key: string, algorithm: HashAlgorithm): Promise<string> {
	if (!text || !key || algorithm === 'MD5') return ''; // MD5 HMAC not supported

	const encoder = new TextEncoder();
	const keyData = encoder.encode(key);
	const textData = encoder.encode(text);

	try {
		const cryptoKey = await crypto.subtle.importKey(
			'raw', keyData,
			{ name: 'HMAC', hash: algorithm },
			false, ['sign']
		);
		const signature = await crypto.subtle.sign('HMAC', cryptoKey, textData);
		const hashArray = Array.from(new Uint8Array(signature));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	} catch (error) {
		console.error('[HMAC] Generation failed', error);
		return '';
	}
}

/**
 * Generate hash for file
 */
export async function generateFileHash(file: File, algorithm: HashAlgorithm): Promise<string> {
	try {
		const arrayBuffer = await file.arrayBuffer();

		// MD5 uses the repository-wide owner
		if (algorithm === 'MD5') {
			return md5Bytes(new Uint8Array(arrayBuffer));
		}

		const hashBuffer = await crypto.subtle.digest(getWebCryptoAlgorithm(algorithm), arrayBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	} catch (error) {
		console.error('[Hash] File hash failed', error);
		return '';
	}
}

/**
 * Verify hash against input - detect algorithm by length and compare
 */
export async function verifyHash(input: string, expectedHash: string): Promise<VerifyResult> {
	const normalized = expectedHash.toLowerCase().replace(/\s/g, '');

	// Detect algorithm by hash length
	const lengthToAlgo: Record<number, HashAlgorithm[]> = {
		32: ['MD5'],
		40: ['SHA-1'],
		64: ['SHA-256'],
		96: ['SHA-384'],
		128: ['SHA-512'],
	};

	const possibleAlgos = lengthToAlgo[normalized.length];
	if (!possibleAlgos) return { match: false };

	for (const algo of possibleAlgos) {
		const computed = await generateHash(input, algo);
		if (computed.toLowerCase() === normalized) {
			return { match: true, algorithm: algo };
		}
	}

	return { match: false };
}

/**
 * Detect hash type by length
 */
export function detectHashType(hash: string): HashAlgorithm | null {
	const len = hash.replace(/\s/g, '').length;
	const map: Record<number, HashAlgorithm> = {
		32: 'MD5', 40: 'SHA-1', 64: 'SHA-256', 96: 'SHA-384', 128: 'SHA-512',
	};
	return map[len] || null;
}
