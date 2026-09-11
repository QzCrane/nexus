// goal: Gzip core logic - compress/decompress using CompressionStream API
// rule: every transform pumps through one owner that (a) awaits the writer so
// stream errors are never unhandled and (b) enforces an explicit output byte
// budget so a decompression bomb cannot exhaust memory.

/** Encoded output ceiling for one compress/decompress operation. */
export const MAX_TRANSFORM_OUTPUT_BYTES = 64 * 1024 * 1024;

async function pumpThroughTransform(
	stream: CompressionStream | DecompressionStream,
	data: Uint8Array,
	maxOutputBytes: number,
): Promise<Uint8Array> {
	const writer = stream.writable.getWriter();
	const reader = stream.readable.getReader();
	let writeFailure: unknown = null;
	// The writer task never rejects: a failure here is stored and rethrown only
	// when the readable side did not already surface the real stream error.
	const writes = (async () => {
		try {
			// The encoders produce ArrayBuffer-backed views; the newer lib dom
			// type cannot express that through the generic parameter alone.
			await writer.write(data as Uint8Array<ArrayBuffer>);
			await writer.close();
		} catch (error) {
			writeFailure = error;
		}
	})();

	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxOutputBytes) {
				const streamTerminated = !(await writer.abort().then(() => true, () => false));
				throw new Error(`transform output exceeds the ${maxOutputBytes} byte budget${streamTerminated ? ' (stream already terminated)' : ''}`);
			}
			chunks.push(value);
		}
	} catch (readError) {
		await writes;
		throw readError;
	}
	await writes;
	if (writeFailure !== null) {
		throw writeFailure instanceof Error ? writeFailure : new Error(String(writeFailure));
	}

	const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

function toBase64(bytes: Uint8Array): string {
	// rule: chunk the conversion — V8's spread call argument limit is ~65K, so
	// `String.fromCharCode(...bytes)` throws RangeError on large inputs.
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

// Compress string to Base64
export async function compress(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const output = await pumpThroughTransform(new CompressionStream('gzip'), data, MAX_TRANSFORM_OUTPUT_BYTES);
	return toBase64(output);
}

// Decompress Base64 to string
export async function decompress(input: string, maxOutputBytes = MAX_TRANSFORM_OUTPUT_BYTES): Promise<string> {
	const binary = atob(input);
	const data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	const output = await pumpThroughTransform(new DecompressionStream('gzip'), data, maxOutputBytes);
	return new TextDecoder().decode(output);
}

// Calculate compression ratio
export function getCompressionRatio(original: number, compressed: number): number {
	if (original === 0) return 0;
	return Math.round((1 - compressed / original) * 100);
}
