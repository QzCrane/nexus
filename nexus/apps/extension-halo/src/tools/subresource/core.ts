// goal: Subresource Integrity (SRI) core logic

export type Algo = 'sha256' | 'sha384' | 'sha512';

// Calculate SRI hash for a string (code content)
export async function calculateSri(content: string, alg: Algo = 'sha384'): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	const hashBuffer = await crypto.subtle.digest(alg.toUpperCase().replace('SHA', 'SHA-'), data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	// Convert to base64
	let binary = '';
	for (const byte of hashArray) binary += String.fromCharCode(byte);
	const base64 = btoa(binary);

	return `${alg}-${base64}`;
}

// Generate <script> or <link> tag
export function generateTag(url: string, integrity: string, type: 'script' | 'link'): string {
	if (type === 'script') {
		return `<script src="${url}" integrity="${integrity}" crossorigin="anonymous"></script>`;
	} else {
		return `<link rel="stylesheet" href="${url}" integrity="${integrity}" crossorigin="anonymous">`;
	}
}
