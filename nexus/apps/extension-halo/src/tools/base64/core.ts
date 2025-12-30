// goal: Base64 encode/decode core logic

/**
 * Encode string to Base64
 */
export function encode(input: string, urlSafe: boolean = false): string {
	if (!input) return '';
	try {
		// Handle UTF-8 characters
		const utf8 = new TextEncoder().encode(input);
		const binary = String.fromCharCode(...utf8);
		let base64 = btoa(binary);

		if (urlSafe) {
			base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		}

		return base64;
	} catch {
		throw new Error('Encoding failed');
	}
}

/**
 * Decode Base64 to string
 */
export function decode(input: string, urlSafe: boolean = false): string {
	if (!input) return '';
	try {
		let base64 = input.trim();

		if (urlSafe) {
			base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
			// Add padding if needed
			while (base64.length % 4) base64 += '=';
		}

		const binary = atob(base64);
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		throw new Error('Invalid Base64 string');
	}
}

/**
 * Check if string is valid Base64
 */
export function isValidBase64(input: string): boolean {
	if (!input) return true;
	try {
		// Try standard or URL-safe
		const standard = /^[A-Za-z0-9+/]*={0,2}$/;
		const urlSafe = /^[A-Za-z0-9\-_]*$/;
		return standard.test(input) || urlSafe.test(input);
	} catch {
		return false;
	}
}

/**
 * Encode file to DataURL
 */
export async function fileToDataURL(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(new Error('File read failed'));
		reader.readAsDataURL(file);
	});
}

/**
 * Get file size from Base64 string
 */
export function getBase64Size(base64: string): number {
	// Base64 size = (length * 3/4) - padding
	const padding = (base64.match(/=+$/) || [''])[0].length;
	return Math.floor((base64.length * 3) / 4) - padding;
}
