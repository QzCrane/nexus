// goal: File checksum calculator core logic
// eff: Calculate MD5, SHA-1, SHA-256, SHA-512 for files

export type HashAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface ChecksumResult {
	algorithm: HashAlgorithm;
	hash: string;
	duration: number; // ms
}

/**
 * Calculate hash for a file using Web Crypto API
 * MD5 uses fallback since Web Crypto doesn't support it
 */
export async function calculateChecksum(
	file: File,
	algorithm: HashAlgorithm
): Promise<ChecksumResult> {
	const startTime = performance.now();

	if (algorithm === 'MD5') {
		const hash = await calculateMD5(file);
		return { algorithm, hash, duration: performance.now() - startTime };
	}

	// Use Web Crypto API for SHA algorithms
	const buffer = await file.arrayBuffer();
	const hashBuffer = await crypto.subtle.digest(algorithm, buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

	return { algorithm, hash, duration: performance.now() - startTime };
}

/**
 * Calculate all supported hashes for a file
 */
export async function calculateAllChecksums(file: File): Promise<ChecksumResult[]> {
	const algorithms: HashAlgorithm[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-512'];
	return Promise.all(algorithms.map(alg => calculateChecksum(file, alg)));
}

/** Verify hash match */
export function verifyChecksum(actual: string, expected: string): boolean {
	return actual.toLowerCase().trim() === expected.toLowerCase().replace(/\s/g, '').trim();
}

/** Format file size */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(2)} KB`;
	if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(2)} MB`;
	return `${(bytes / 1073741824).toFixed(2)} GB`;
}

// ============ MD5 Implementation (RFC 1321) ============

async function calculateMD5(file: File): Promise<string> {
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	const S = [
		7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
		5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
		4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
		6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
	];

	const K = new Uint32Array(64);
	for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);

	let a0 = 0x67452301, b0 = 0xEFCDAB89, c0 = 0x98BADCFE, d0 = 0x10325476;

	const origLen = bytes.length;
	const paddedLen = ((origLen + 8) >>> 6 << 6) + 64;
	const padded = new Uint8Array(paddedLen);
	padded.set(bytes);
	padded[origLen] = 0x80;

	const view = new DataView(padded.buffer);
	view.setUint32(paddedLen - 8, (origLen * 8) >>> 0, true);
	view.setUint32(paddedLen - 4, Math.floor((origLen * 8) / 0x100000000), true);

	for (let i = 0; i < paddedLen; i += 64) {
		const M = new Uint32Array(16);
		for (let j = 0; j < 16; j++) M[j] = view.getUint32(i + j * 4, true);

		let A = a0, B = b0, C = c0, D = d0;

		for (let j = 0; j < 64; j++) {
			let F: number, g: number;
			if (j < 16) { F = (B & C) | (~B & D); g = j; }
			else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
			else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
			else { F = C ^ (B | ~D); g = (7 * j) % 16; }

			F = (F + A + K[j] + M[g]) >>> 0;
			A = D; D = C; C = B;
			B = (B + ((F << S[j]) | (F >>> (32 - S[j])))) >>> 0;
		}

		a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0;
		c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
	}

	const toHex = (n: number) => {
		const b = [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
		return b.map(x => x.toString(16).padStart(2, '0')).join('');
	};

	return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}
