// goal: Base64 encode/decode core logic with blob support

/**
 * Encode string to Base64
 */
export function encode(input: string, urlSafe: boolean = false): string {
	if (!input) return '';
	try {
		const utf8 = new TextEncoder().encode(input);
		// rule: chunk the conversion — V8's spread call argument limit is ~65K, so
		// `String.fromCharCode(...utf8)` throws RangeError on any input whose UTF-8 form
		// exceeds ~64KB. 0x8000 (32KB) chunks stay well under the limit.
		let binary = '';
		const CHUNK = 0x8000;
		for (let i = 0; i < utf8.length; i += CHUNK) {
			binary += String.fromCharCode(...utf8.subarray(i, i + CHUNK));
		}
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
 * Decode Base64 to string (UTF-8)
 */
export function decode(input: string, urlSafe: boolean = false): string {
	if (!input) return '';
	try {
		let base64 = input.trim();
		if (urlSafe) {
			base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
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
 * Decode Base64 to Uint8Array for binary data
 */
export function decodeToBinary(input: string, urlSafe: boolean = false): Uint8Array {
	let base64 = input.trim().replace(/^data:.*?;base64,/, '');
	if (urlSafe) {
		base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
		while (base64.length % 4) base64 += '=';
	}
	const binary = atob(base64);
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
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
	const cleaned = base64.replace(/^data:.*?;base64,/, '');
	const padding = (cleaned.match(/=+$/) || [''])[0].length;
	return Math.floor((cleaned.length * 3) / 4) - padding;
}

/**
 * Download content as file
 */
export function downloadContent(data: Uint8Array | string, filename: string, type: string) {
	const blob = new Blob([data as any], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
