// goal: File checksum calculator core logic
// eff: Calculate MD5, SHA-1, SHA-256, SHA-512 for files with one file read.
// note: MD5 is delegated to the repository-wide owner in kernel/utils/md5.ts.

import { md5Bytes } from '../../kernel/utils/md5';

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
function digestToHex(digest: ArrayBuffer): string {
	return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function calculateChecksum(
	file: File,
	algorithm: HashAlgorithm
): Promise<ChecksumResult> {
	const startTime = performance.now();
	const buffer = await file.arrayBuffer();
	const hash = algorithm === 'MD5'
		? md5Bytes(new Uint8Array(buffer))
		: digestToHex(await crypto.subtle.digest(algorithm, buffer));

	return { algorithm, hash, duration: performance.now() - startTime };
}

/**
 * Calculate all supported hashes for a file
 */
export async function calculateAllChecksums(file: File): Promise<ChecksumResult[]> {
	const startTime = performance.now();
	// rule: read the file exactly once — per-algorithm reads re- ingested the
	// whole file four times and quadrupled the I/O cost of every check.
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const algorithms: HashAlgorithm[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-512'];
	const results = await Promise.all(algorithms.map(async (algorithm): Promise<ChecksumResult> => {
		const hash = algorithm === 'MD5'
			? md5Bytes(bytes)
			: digestToHex(await crypto.subtle.digest(algorithm, buffer));
		return { algorithm, hash, duration: performance.now() - startTime };
	}));
	return results;
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
