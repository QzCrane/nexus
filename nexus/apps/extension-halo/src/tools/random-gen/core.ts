// goal: Random Generator core logic

// Generate cryptographically strong random bytes
export function getRandomBytes(length: number): Uint8Array {
	const arr = new Uint8Array(length);
	crypto.getRandomValues(arr);
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
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
	return btoa(binary).slice(0, length);
}

// Generate UUID v4
export function generateUUID(): string {
	return crypto.randomUUID();
}

// Generate ULID-like (Timestamp + Random)
export function generateULID(): string {
	// Simplified implementation for uniqueness sorting
	const time = Date.now();
	const random = generateHex(16);
	return `${time.toString(36).toUpperCase()}${random.toUpperCase()}`;
}
