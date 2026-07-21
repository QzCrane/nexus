// goal: Gzip core logic - compress/decompress using CompressionStream API

// Compress string to Base64
export async function compress(input: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(input);

	const cs = new CompressionStream('gzip');
	const writer = cs.writable.getWriter();
	writer.write(data);
	writer.close();

	const reader = cs.readable.getReader();
	const chunks: Uint8Array[] = [];
	let done = false;

	while (!done) {
		const result = await reader.read();
		done = result.done;
		if (result.value) chunks.push(result.value);
	}

	const compressed = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		compressed.set(chunk, offset);
		offset += chunk.length;
	}

	// rule: chunk the conversion — V8's spread call argument limit is ~65K, so
	// `String.fromCharCode(...compressed)` throws RangeError on large inputs.
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < compressed.length; i += CHUNK) {
		binary += String.fromCharCode(...compressed.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

// Decompress Base64 to string
export async function decompress(input: string): Promise<string> {
	const binary = atob(input);
	const data = Uint8Array.from(binary, (c) => c.charCodeAt(0));

	const ds = new DecompressionStream('gzip');
	const writer = ds.writable.getWriter();
	writer.write(data);
	writer.close();

	const reader = ds.readable.getReader();
	const chunks: Uint8Array[] = [];
	let done = false;

	while (!done) {
		const result = await reader.read();
		done = result.done;
		if (result.value) chunks.push(result.value);
	}

	const decompressed = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		decompressed.set(chunk, offset);
		offset += chunk.length;
	}

	return new TextDecoder().decode(decompressed);
}

// Calculate compression ratio
export function getCompressionRatio(original: number, compressed: number): number {
	if (original === 0) return 0;
	return Math.round((1 - compressed / original) * 100);
}
