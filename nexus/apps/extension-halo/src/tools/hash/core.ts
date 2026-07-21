// goal: Hash generation core logic with MD5, HMAC, and verification support

import type { HashAlgorithm, VerifyResult } from './types';

// MD5 implementation (Web Crypto doesn't support MD5)
function md5(message: string): string {
	function rotateLeft(value: number, shift: number): number {
		return (value << shift) | (value >>> (32 - shift));
	}

	const str = unescape(encodeURIComponent(message));
	const len = str.length;
	const words: number[] = [];

	for (let i = 0; i < len; i++) {
		words[i >> 2]! |= str.charCodeAt(i) << ((i % 4) * 8);
	}
	words[len >> 2]! |= 0x80 << ((len % 4) * 8);
	const bitLen = len * 8;
	const padLen = (((len + 8) >> 6) + 1) * 16;
	words[padLen - 2] = bitLen;
	words[padLen - 1] = 0;

	let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;

	const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
	// rule: hardcode the standard MD5 K table per RFC 1321. The previous
	// implementation computed K[i] = floor(abs(sin(i+1)) * 2^32) at runtime, which
	// depends on Math.sin precision and could produce different values across JS
	// engines (V8/JSC/SpiderMonkey) for some indices — a known MD5 portability bug.
	// The hardcoded values are the canonical RFC 1321 constants.
	const K = new Uint32Array([
		0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
		0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
		0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
		0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
		0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
		0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
		0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
		0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
		0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
		0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
		0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
		0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
		0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
		0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
		0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
		0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
	]);

	for (let i = 0; i < padLen; i += 16) {
		const aa = a, bb = b, cc = c, dd = d;
		for (let j = 0; j < 64; j++) {
			let f: number, g: number;
			if (j < 16) { f = (b & c) | (~b & d); g = j; }
			else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
			else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
			else { f = c ^ (b | ~d); g = (7 * j) % 16; }
			const temp = d;
			d = c; c = b;
			b = b + rotateLeft((a + f + K[j]! + (words[i + g] || 0)) >>> 0, S[(j >> 4) * 4 + (j % 4)]!);
			a = temp;
		}
		a = (a + aa) >>> 0; b = (b + bb) >>> 0; c = (c + cc) >>> 0; d = (d + dd) >>> 0;
	}

	const toHex = (n: number) => {
		let s = '';
		for (let i = 0; i < 4; i++) s += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, '0');
		return s;
	};
	return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

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

	// MD5 uses custom implementation
	if (algorithm === 'MD5') {
		return md5(text);
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

		// MD5 uses custom implementation
		if (algorithm === 'MD5') {
			const bytes = new Uint8Array(arrayBuffer);
			// rule: chunk the conversion — V8's spread call argument limit is ~65K, so
			// `String.fromCharCode(...bytes)` previously threw RangeError for any file >64KB,
			// silently caught and returned '' (broke MD5 file hashing entirely).
			let str = '';
			const CHUNK = 0x8000;
			for (let i = 0; i < bytes.length; i += CHUNK) {
				str += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
			}
			return md5(str);
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
