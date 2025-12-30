// goal: Hash generation core logic using Web Crypto API

import type { HashAlgorithm } from './types';

/**
 * Generate hash for text
 */
export async function generateHash(text: string, algorithm: HashAlgorithm): Promise<string> {
	if (!text) return '';

	const encoder = new TextEncoder();
	const data = encoder.encode(text);

	try {
		const hashBuffer = await crypto.subtle.digest(algorithm, data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
		return hashHex;
	} catch (error) {
		console.error('Hash generation processing failed', error);
		return '';
	}
}

/**
 * Generate hash for file
 */
export async function generateFileHash(file: File, algorithm: HashAlgorithm): Promise<string> {
	try {
		const arrayBuffer = await file.arrayBuffer();
		const hashBuffer = await crypto.subtle.digest(algorithm, arrayBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
		return hashHex;
	} catch (error) {
		console.error('File hash generation failed', error);
		return '';
	}
}
