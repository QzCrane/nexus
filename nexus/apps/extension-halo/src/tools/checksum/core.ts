// goal: Checksum core logic - file hash verification

export type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

// Calculate file hash
export async function calculateFileHash(file: File, algorithm: HashAlgorithm): Promise<string> {
	const buffer = await file.arrayBuffer();
	const hashBuffer = await crypto.subtle.digest(algorithm, buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Verify hash
export function verifyHash(calculated: string, expected: string): boolean {
	return calculated.toLowerCase() === expected.toLowerCase().replace(/\s/g, '');
}

// Format file size
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
